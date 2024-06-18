import * as fs from "fs";
import * as bs58 from "bs58";

import * as web3 from "@solana/web3.js";
import { Connection } from "@solana/web3.js";
import { checkTxIds, loadTxIdsFromFile } from "./utils";
import dotenv from "dotenv";
dotenv.config();

async function parse_csv(connection: Connection) {
  const fileContent = fs.readFileSync(
    "./2024_06_05_20_22_46_S202406052022402185.csv",
    { encoding: "utf-8" },
  );
  const lines = fileContent.split(/\r?\n/).slice(1);
  for (const line of lines) {
    const tx = line.split(",")[2];
    const result = await connection.getSignatureStatus(tx, {
      searchTransactionHistory: true,
    });
    if (result.value?.confirmationStatus !== undefined) {
      console.log(tx);
    }
  }
}

async function main() {
  const connection = new web3.Connection(
    process.env.SOLANA_RPC_ENDPOINT || "",
    "confirmed",
  );

  const txIds = loadTxIdsFromFile();
  await checkTxIds(connection, txIds);
}

main();
