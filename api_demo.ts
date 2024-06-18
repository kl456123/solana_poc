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
} from "@solana/web3.js";
import * as borsh from "borsh";
import fetch from "cross-fetch";
import { Wallet } from "@project-serum/anchor";
import * as bs58 from "bs58";
import axios from "axios";
import { checkTxIds, saveTxIdsToFile } from "./utils";
import dotenv from "dotenv";
dotenv.config();

// 0.00005 sol
const minPriorityFee = 100000000000;
// 0.0001 sol
const maxPriorityFee = 100000000000;
const jupiter_api_url = "quote-api.jup.ag/v6";

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

async function getPriorityFee(connection: Connection) {
  // find the best priority fee according to current condition onchain
  const recentPrioritizationFees = await connection.getRecentPrioritizationFees(
    {
      lockedWritableAccounts: [
        new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"),
      ],
    },
  );
  // recentPrioritizationFees.sort((a, b) => a.slot - b.slot);
  recentPrioritizationFees.sort(
    (a, b) => b.prioritizationFee - a.prioritizationFee,
  );
  return recentPrioritizationFees;
}

async function estimateUnitLimit(
  transaction: VersionedTransaction,
  connection: Connection,
) {
  const simulationResult = await connection.simulateTransaction(transaction, {
    replaceRecentBlockhash: true,
    // sigVerify: false,
    commitment: "processed",
  });
  const multipler = 1.1;
  return Math.floor(simulationResult.value.unitsConsumed! * multipler);
}

function decodePriorityFee(message: TransactionMessage) {
  let unitLimit, unitPrice;
  for (const instruction of message.instructions) {
    if (instruction.programId.equals(ComputeBudgetProgram.programId)) {
      const discriminator = instruction.data[0];
      switch (discriminator) {
        case 2: {
          unitLimit = borsh.deserialize(
            { struct: { discriminator: "u8", units: "u32" } },
            Buffer.from(instruction.data),
          );
          break;
        }
        case 3: {
          unitPrice = borsh.deserialize(
            { struct: { discriminator: "u8", microLamports: "u64" } },
            Buffer.from(instruction.data),
          );
          break;
        }
        default: {
          break;
        }
      }
    }
  }
  return {
    unitLimit,
    unitPrice,
  };
}

// adjust message in version transaction
async function setPriorityFee(
  params: {
    unitPrice?: number;
    unitLimit?: number;
  },
  transaction: VersionedTransaction,
  connection: Connection,
) {
  // get address lookup table accounts
  const addressLookupTableAccounts = await Promise.all(
    transaction.message.addressTableLookups.map(async (lookup) => {
      return new AddressLookupTableAccount({
        key: lookup.accountKey,
        state: AddressLookupTableAccount.deserialize(
          await connection
            .getAccountInfo(lookup.accountKey)
            .then((res) => res!.data),
        ),
      });
    }),
  );
  const message = TransactionMessage.decompile(transaction.message, {
    addressLookupTableAccounts: addressLookupTableAccounts,
  });

  // console.log("before: ", decodePriorityFee(message));
  // if (params.unitLimit === undefined) {
  // let unitLimit = await estimateUnitLimit(transaction, connection);
  // params.unitLimit = unitLimit === 0 ? 500000 : unitLimit;
  // }

  // if (params.unitPrice === undefined) {
  // params.unitPrice = 250000;
  // }
  // const limitIx = ComputeBudgetProgram.setComputeUnitLimit({
  // units: params.unitLimit,
  // });
  // const priceIx = ComputeBudgetProgram.setComputeUnitPrice({
  // microLamports: params.unitPrice,
  // });

  // let replaceUnitLimt = false;
  // let replaceUnitPrice = false;
  // for (let i = 0; i < message.instructions.length; ++i) {
  // const instruction = message.instructions[i];
  // if (instruction.programId.equals(ComputeBudgetProgram.programId)) {
  // const discriminator = instruction.data[0];
  // switch (discriminator) {
  // case 2: {
  // message.instructions[i] = limitIx;
  // replaceUnitLimt = true;
  // break;
  // }
  // case 3: {
  // message.instructions[i] = priceIx;
  // replaceUnitPrice = true;
  // break;
  // }
  // default: {
  // break;
  // }
  // }
  // }
  // }
  // if (!replaceUnitPrice) {
  // message.instructions = [priceIx, ...message.instructions];
  // }
  // if (!replaceUnitLimt) {
  // message.instructions = [limitIx, ...message.instructions];
  // }

  console.log("after: ", decodePriorityFee(message));
  transaction.message = message.compileToV0Message(addressLookupTableAccounts);
}

async function getTransaction(
  quoteResponse: {},
  userPublicKey: string,
): Promise<VersionedTransaction> {
  const data = JSON.stringify({
    // route from /quote api
    quoteResponse,
    // user public key to be used for the swap
    userPublicKey,
    // auto wrap and unwrap SOL. default is true
    wrapUnwrapSOL: true,
    prioritizationFeeLamports: "auto",
    // prioritizationFeeLamports: {
    //   autoMultiplier: 2,
    // },
    dynamicComputeUnitLimit: true,
    // feeAccount is optional. Use if you want to charge a fee.  feeBps must have been passed in /quote API.
    // This is the ATA account for the output token where the fee will be sent to. If you are swapping from SOL->USDC then this would be the USDC ATA you want to collect the fee.
    // feeAccount: "fee_account_public_key"
  });

  let config = {
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
      const tx = new Transaction();
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

async function sendTransaction(
  connection: Connection,
  transaction: VersionedTransaction,
  signers: Keypair[],
  updateBlockHash = true,
) {
  if (updateBlockHash) {
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");
    transaction.message.recentBlockhash = blockhash;
  }
  // sign the transaction
  // await new Promise(resolve => setTimeout(resolve, 4000));
  transaction.sign(signers);

  // Execute the transaction
  const rawTransaction = transaction.serialize();
  const txid = await connection.sendRawTransaction(rawTransaction, {
    skipPreflight: true,
    maxRetries: 10,
  });
  // await connection.confirmTransaction(txid);
  // console.log(`https://solscan.io/tx/${txid}`);
  return txid;
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
  for (let i = 0; i < numTxs; ) {
    const quoteRequestParams = {
      inputMint: "So11111111111111111111111111111111111111112",
      outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      amount: 10000000,
      restrictIntermediateTokens: true,
      slippageBps: 100,
      // autoSlippage: true,
    };
    const route = await getQuote(quoteRequestParams);

    //////////////   get transaction to swap onchain ////////////////
    // get serialized transactions for the swap
    const transaction = await getTransaction(
      route,
      wallet.publicKey.toString(),
    );

    // console.log(await getPriorityFee(connection))

    // set already in tx returned from jupiter api
    const unitPrice = undefined;
    const unitLimit = undefined;
    await setPriorityFee({ unitPrice, unitLimit }, transaction, connection);

    await retry(
      async () => {
        const txId = await sendTransaction(connection, transaction, [
          wallet.payer,
        ]);
        console.log(`send tx with txId: ${txId}`);
        txIds.push(txId);
        ++i;
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
  }

  // TODO(save txIds to log file)
  saveTxIdsToFile(txIds, true);
  // await new Promise(f => setTimeout(f, 1000));
  // await checkTxIds(connection, txIds)
}

main();
