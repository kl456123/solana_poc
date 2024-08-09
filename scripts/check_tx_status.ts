import * as fs from "fs";
import * as bs58 from "bs58";

import * as web3 from "@solana/web3.js";
import { Connection } from "@solana/web3.js";
import { checkTxIds, loadTxIdsFromFile } from "../src/utils";
import dotenv from "dotenv";
dotenv.config();

function loadTxIdsFromCSV(path: string) {
  const fileContent = fs.readFileSync(path, { encoding: "utf-8" });
  const lines = fileContent
    .split(/\r?\n/)
    .slice(1)
    .filter((item) => item.length > 0);
  const txIds = [];
  for (const line of lines) {
    txIds.push(line.split(",")[1]);
  }
  return txIds;
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
