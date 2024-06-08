import * as fs from "fs";
import * as bs58 from "bs58";

import * as web3 from "@solana/web3.js";
import {
  Connection,
  Keypair,
  TransactionConfirmationStrategy,
  BlockheightBasedTransactionConfirmationStrategy,
} from "@solana/web3.js";
import dotenv from "dotenv";
dotenv.config();

async function transfer(connection: Connection, from: Keypair) {
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  const transaction = new web3.Transaction({
    blockhash,
    lastValidBlockHeight,
  }).add(
    web3.SystemProgram.transfer({
      fromPubkey: from.publicKey,
      toPubkey: from.publicKey,
      lamports: web3.LAMPORTS_PER_SOL / 100,
    }),
  );
  const signers = [from];
  transaction.sign(...signers);
  const wireTransaction = transaction.serialize();
  const confirmationStrategy: BlockheightBasedTransactionConfirmationStrategy =
    {
      blockhash,
      lastValidBlockHeight,
      signature: bs58.encode(transaction.signature!),
    };
  const start = Date.now();
  const signature = await web3.sendAndConfirmRawTransaction(
    connection,
    wireTransaction,
    confirmationStrategy,
  );
  const duration = Date.now() - start;
  console.log("SIGNATURE", signature, `time elapase: ${duration}`);
}

async function transfer_finalized(connection: Connection, from: Keypair) {
  {
    const transaction = new web3.Transaction().add(
      web3.SystemProgram.transfer({
        fromPubkey: from.publicKey,
        toPubkey: from.publicKey,
        lamports: web3.LAMPORTS_PER_SOL / 100,
      }),
    );
    const signers = [from];
    // Sign transaction, broadcast, and confirm
    const start = Date.now();
    const signature = await web3.sendAndConfirmTransaction(
      connection,
      transaction,
      signers,
    );
    const duration = Date.now() - start;
    console.log("SIGNATURE", signature, `time elapase: ${duration}`);
  }
}

async function main() {
  const connection = new web3.Connection(
    process.env.SOLANA_RPC_ENDPOINT || "",
    "confirmed",
  );
  const from = Keypair.fromSecretKey(
    bs58.decode(process.env.PRIVATE_KEY || ""),
  );

  for (let i = 0; i < 5; ++i) {
    transfer(connection, from);
    // transfer_finalized(connection, from)
  }
}

main();
