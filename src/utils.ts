import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import fs from "fs";
import axios from "axios";

export const DEFAULT_LOG_FILE = "./data/swap.log";

export async function checkTxIds(connection: Connection, txIds: string[]) {
  const totalCounts = txIds.length;
  let successCounts = 0;
  let onChainCounts = 0;
  for (const txId of txIds) {
    const result = await connection.getSignatureStatus(txId, {
      searchTransactionHistory: true,
    });
    if (result.value?.confirmationStatus !== undefined) {
      onChainCounts += 1;
      console.log(
        `tx[${result.value?.confirmationStatus}] : ${txId} is sent successfully`,
      );
      if (result.value.err !== null) {
        // {"InstructionError":[5,{"Custom":6001}]} Slippage tolerance exceeded
        // {"InstructionError":[5,{"Custom":6003}]} Stale oracle price
        console.log(`err: ${JSON.stringify(result.value.err)}`);
      } else {
        successCounts += 1;
      }
    } else {
      console.log(`tx: ${txId} is failed to send`);
    }
  }
  console.log(`total num of tx: ${txIds.length}`);
  console.log(`fail rate: ${(totalCounts - successCounts) / totalCounts}`);
  console.log(`lost rate: ${(totalCounts - onChainCounts) / totalCounts}`);
}

export function saveTxIdsToFile(
  txIds: string[],
  overwrite = false,
  logFile: string = DEFAULT_LOG_FILE,
) {
  // load from file
  let savedTxIds: string[] = [];
  if (!overwrite && fs.existsSync(logFile)) {
    savedTxIds.push(...JSON.parse(fs.readFileSync(logFile, "utf-8")));
  }
  savedTxIds.push(...txIds);
  // save back
  fs.writeFileSync(logFile, JSON.stringify(savedTxIds, null, 2));
}

export function loadTxIdsFromFile(path: string = DEFAULT_LOG_FILE) {
  const txIds = JSON.parse(fs.readFileSync(path, "utf-8"));
  return txIds;
}

export async function getBundleStatus(bundleId: string) {
  const url = "https://mainnet.block-engine.jito.wtf/api/v1/bundles";
  const method = "getBundleStatuses";
  const request = {
    jsonrpc: "2.0",
    id: 1,
    method,
    params: [[bundleId]],
  };
  const { data } = await axios.post(url, JSON.stringify(request), {
    headers: { "Content-Type": "application/json" },
  });
  return data;
}
