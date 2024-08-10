import retry from "async-retry";
import {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
  Transaction,
  TransactionMessage,
  ComputeBudgetProgram,
  AddressLookupTableAccount,
  SystemProgram,
} from "@solana/web3.js";
import * as borsh from "borsh";
import fetch from "cross-fetch";
import { Wallet } from "@project-serum/anchor";
import * as bs58 from "bs58";
import axios from "axios";
import {
  checkTxIds,
  saveTxIdsToFile,
  sendTransaction,
  clearPriorityFee,
  setPriorityFee,
  printPriorityFee,
} from "../src/utils";
import { jitoBaseUrls, JitoRegion } from "../src/constants";
import dotenv from "dotenv";
dotenv.config();

// 0.00005 sol
const minPriorityFee = 100000000000;
// 0.0001 sol
const maxPriorityFee = 100000000000;
const estimateByApi = false;
const jupiter_api_url = "quote-api.jup.ag/v6";
const useJito = true;

async function retriveRoutedMap() {
  const indexedRouteMap = await (
    await fetch(`${jupiter_api_url}/indexed-route-map`)
  ).json();
  const getMint = (index: number) => indexedRouteMap["mintKeys"][index];
  const getIndex = (mint: string) => indexedRouteMap["mintKeys"].indexOf(mint);
  // generate route map by replacing indexes with mint addresses
  var generatedRouteMap: { [key: string]: string[] } = ({} = {});
  // Object.keys(indexedRouteMap['indexedRouteMap']).forEach((key, index) => {
  // generatedRouteMap[getMint(key)] = indexedRouteMap["indexedRouteMap"][key].map((index) => getMint(index))
  // });

  // list all possible input tokens by mint Address
  const allInputMints = Object.keys(generatedRouteMap);

  // list tokens can swap by mint address for SOL
  const swappableOutputForSol =
    generatedRouteMap["So11111111111111111111111111111111111111112"];
  console.log({ allInputMints, swappableOutputForSol });
}

async function getQuote(params?: {}): Promise<{}> {
  let config = {
    method: "get",
    maxBodyLength: Infinity,
    url: `https://${jupiter_api_url}/quote`,
    params,
    headers: {
      Accept: "application/json",
    },
  };

  return await retry(
    async () => {
      const response = await axios.request(config);
      return response.data;
    },
    {
      retries: 3,
      onRetry: (err, retry) => {
        // reset pools
        console.log(
          err.message,
          `Failed request for quote. Retry attempt: ${retry}`,
        );
      },
    },
  );
}

async function getTransaction(
  quoteResponse: {},
  userPublicKey: string,
  options:
    | {}
    | {
        prioritizationFeeLamports: number | "auto";
        dynamicComputeUnitLimit: boolean;
      },
): Promise<VersionedTransaction> {
  const data = JSON.stringify({
    // route from /quote api
    quoteResponse,
    // user public key to be used for the swap
    userPublicKey,
    // auto wrap and unwrap SOL. default is true
    wrapUnwrapSOL: true,
    ...options,
    // feeAccount is optional. Use if you want to charge a fee.  feeBps must have been passed in /quote API.
    // This is the ATA account for the output token where the fee will be sent to. If you are swapping from SOL->USDC then this would be the USDC ATA you want to collect the fee.
    // feeAccount: "fee_account_public_key"
  });

  const config = {
    method: "post",
    maxBodyLength: Infinity,
    url: `https://${jupiter_api_url}/swap`,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    data: data,
  };

  return await retry(
    async () => {
      const response = await axios.request(config);
      const { swapTransaction } = response.data;

      // deserialize the transaction
      const swapTransactionBuf = Buffer.from(swapTransaction, "base64");
      return VersionedTransaction.deserialize(swapTransactionBuf);
    },
    {
      retries: 3,
      onRetry: (err, retry) => {
        // reset pools
        console.log(
          err.message,
          `Failed request for swap. Retry attempt: ${retry}`,
        );
      },
    },
  );
}

async function main() {
  const connection = new Connection(
    process.env.SOLANA_RPC_ENDPOINT || "",
    "confirmed",
  );
  const wallet = new Wallet(
    Keypair.fromSecretKey(bs58.decode(process.env.PRIVATE_KEY || "")),
  );

  // retrieve indexed routed map
  // await retriveRoutedMap()

  //////////// quote /////////
  // swapping SOL to USDC with input 0.1 SOL and 0.5% slippage
  const txIds: string[] = [];
  const numTxs = 100;
  for (let i = 0; i < numTxs; ++i) {
    // skip any failure cases after retry multiple times
    try {
      const quoteRequestParams: any = {
        inputMint: "So11111111111111111111111111111111111111112",
        outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        amount: 10000000,
        restrictIntermediateTokens: true,
      };
      if (estimateByApi) {
        quoteRequestParams.autoSlippage = true;
      } else {
        quoteRequestParams.slippageBps = 100;
      }
      const route = await getQuote(quoteRequestParams);

      const option = estimateByApi
        ? {
            // prioritizationFeeLamports: "auto",
            prioritizationFeeLamports: {
              autoMultiplier: 2,
            },
            dynamicComputeUnitLimit: true,
          }
        : {};

      //////////////   get transaction to swap onchain ////////////////
      // get serialized transactions for the swap
      const transaction = await getTransaction(
        route,
        wallet.publicKey.toString(),
        option,
      );

      // set already in tx returned from jupiter api
      // NOTE(when enable jito, priority fee is not necessary)
      if (useJito) {
        // clean all ixs of ComputeBudgetProgram
        await clearPriorityFee(transaction, connection);
      } else if (!estimateByApi) {
        const unitPrice = 50_000;
        const unitLimit = undefined;
        await setPriorityFee({ unitPrice, unitLimit }, transaction, connection);
      } else {
        await printPriorityFee(transaction, connection);
      }

      await retry(
        async () => {
          const txId = await sendTransaction(
            connection,
            transaction,
            [wallet.payer],
            true,
            useJito,
          );
          console.log(`send tx with txId: ${txId}`);
          txIds.push(txId);
        },
        {
          retries: 3,
          onRetry: (err, retry) => {
            // reset pools
            console.log(
              err.message,
              `Failed to send transaction. Retry attempt: ${retry}`,
            );
          },
        },
      );
    } catch (e) {
      console.log(`skip failure case due to error: ${e}`);
    }
  }

  saveTxIdsToFile(txIds, true);
}

main();
