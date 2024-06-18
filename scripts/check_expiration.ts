import * as fs from "fs";
import * as bs58 from "bs58";

import * as web3 from "@solana/web3.js";
import dotenv from "dotenv";
dotenv.config();

async function main() {
  const connection = new web3.Connection(
    process.env.SOLANA_RPC_ENDPOINT || "",
    "confirmed",
  );
  const txId =
    "5PfpuVPk1JGicmpTnRuqkr6RtnDBpkcXPXE2nRJQuufFW7ogMHNak9TAQBDKCAvbxzu5xJYvzqxLTUX5LWLuJZzK";
  const tx = (await connection.getParsedTransaction(txId, {
    maxSupportedTransactionVersion: 0,
  }))!;
  const targetBlockHash = tx.transaction.message.recentBlockhash;
  console.log("targetBlockHash: ", targetBlockHash);
  console.log("tx slot: ", tx.slot);
  for (let i = 0; i <= 150; ++i) {
    try {
      const block = await connection.getBlock(tx.slot - i, {
        maxSupportedTransactionVersion: 0,
        transactionDetails: "none",
      });
      if (block !== null && block.blockhash === targetBlockHash) {
        console.log(tx.slot - i);
        break;
      }
    } catch {
      // skip empty block
    } finally {
      // log current progress
      console.log(i);
    }
  }
}

main();
