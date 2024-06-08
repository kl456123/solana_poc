import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import fs from "fs";

export const DEFAULT_LOG_FILE = "./data/swap.log";

export async function checkTxIds(connection: Connection, txIds: string[]) {
  for (const txId of txIds) {
    const result = await connection.getSignatureStatus(txId, {
      searchTransactionHistory: true,
    });
    if (result.value?.confirmationStatus !== undefined) {
      console.log(`tx: ${txId} is sent successfully`);
    } else {
      console.log(`tx: ${txId} is fail to send`);
    }
  }
}

export function saveTxIdsToFile(
  txIds: string[],
  logFile: string = DEFAULT_LOG_FILE,
) {
  // load from file
  let savedTxIds: string[] = [];
  if (fs.existsSync(logFile)) {
    savedTxIds = JSON.parse(fs.readFileSync(logFile, "utf-8"));
  }
  savedTxIds.push(...txIds);
  // save back
  fs.writeFileSync(logFile, JSON.stringify(savedTxIds, null, 2));
}

export function loadTxIdsFromFile(path: string = DEFAULT_LOG_FILE) {
  const txIds = JSON.parse(fs.readFileSync(path, "utf-8"));
  return txIds;
}
