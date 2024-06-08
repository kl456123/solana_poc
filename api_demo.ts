import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import fetch from "cross-fetch";
import { Wallet } from "@project-serum/anchor";
import * as bs58 from "bs58";
import axios from "axios";
import { checkTxIds, saveTxIdsToFile } from "./utils";
import dotenv from "dotenv";
dotenv.config();

async function retriveRoutedMap() {
  const indexedRouteMap = await (
    await fetch("https://quote-api.jup.ag/v4/indexed-route-map")
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

async function getQuote(params?: {}) {
  let config = {
    method: "get",
    maxBodyLength: Infinity,
    url: "https://quote-api.jup.ag/v6/quote",
    params,
    headers: {
      Accept: "application/json",
    },
  };

  const response = await axios.request(config);
  return response.data;
}

async function getTransaction(quoteResponse: {}, userPublicKey: string) {
  const data = JSON.stringify({
    // route from /quote api
    quoteResponse,
    // user public key to be used for the swap
    userPublicKey,
    // auto wrap and unwrap SOL. default is true
    wrapUnwrapSOL: true,
    // feeAccount is optional. Use if you want to charge a fee.  feeBps must have been passed in /quote API.
    // This is the ATA account for the output token where the fee will be sent to. If you are swapping from SOL->USDC then this would be the USDC ATA you want to collect the fee.
    // feeAccount: "fee_account_public_key"
  });

  let config = {
    method: "post",
    maxBodyLength: Infinity,
    url: "https://quote-api.jup.ag/v6/swap",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    data: data,
  };

  const response = await axios.request(config);
  const { swapTransaction } = response.data;

  // deserialize the transaction
  const swapTransactionBuf = Buffer.from(swapTransaction, "base64");
  var transaction = VersionedTransaction.deserialize(swapTransactionBuf);
  return transaction;
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
  transaction.sign(signers);

  // Execute the transaction
  const rawTransaction = transaction.serialize();
  const txid = await connection.sendRawTransaction(rawTransaction, {
    skipPreflight: true,
    maxRetries: 10,
  });
  return txid;
  // await connection.confirmTransaction(txid);
  // console.log(`https://solscan.io/tx/${txid}`);
}

async function main() {
  const ENV = "mainnet-beta";
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
  const txIds = [];
  for (let i = 0; i < 10; ++i) {
    const quoteRequestParams = {
      inputMint: "So11111111111111111111111111111111111111112",
      outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      amount: 100000000,
      slippageBps: 50,
    };
    const route = await getQuote(quoteRequestParams);

    //////////////   get transaction to swap onchain ////////////////
    // get serialized transactions for the swap
    const transaction = await getTransaction(
      route,
      wallet.publicKey.toString(),
    );

    const txId = await sendTransaction(connection, transaction, [wallet.payer]);
    txIds.push(txId);
  }

  // TODO(save txIds to log file)
  saveTxIdsToFile(txIds);
  // await new Promise(f => setTimeout(f, 1000));
  // await checkTxIds(connection, txIds)
}

main();
