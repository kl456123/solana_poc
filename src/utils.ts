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
import { searcher, bundle } from "jito-ts";
import * as borsh from "borsh";
import fs from "fs";
import axios from "axios";
import * as bs58 from "bs58";
import { jitoBaseUrls, JitoRegion } from "../src/constants";

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

export async function getBundleStatus(
  bundleId: string,
  baseUrl = jitoBaseUrls[JitoRegion.Tokyo],
) {
  const method = "getBundleStatuses";
  const request = {
    jsonrpc: "2.0",
    id: 1,
    method,
    params: [[bundleId]],
  };
  const { data } = await axios.post(
    `${baseUrl}/api/v1`,
    JSON.stringify(request),
    {
      headers: { "Content-Type": "application/json" },
    },
  );
  return data;
}

export async function sendTransactionByApi(
  rawTransaction: Uint8Array,
  baseUrl = "http://10.100.112.186:9305/",
) {
  const config = {
    method: "post",
    maxBodyLength: Infinity,
    url: `${baseUrl}/v1/private/wallet-direct/buw/wallet/networks/onchain/send-transacton`,
    data: {
      binanceChainId: "CT_501",
      signedTransaction: Buffer.from(rawTransaction).toString("base64"),
    },
    headers: {
      "x-gray-env": "w3w-2416",
      "x-trace-id": "003753b777384c63846f50174347e0fd",
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  };
  const result = await axios.request(config);
  const txid = result.data.data.txId;
  return txid;
}

export async function sendTransactionByJito(
  feePayer: Keypair,
  rawTransaction: Uint8Array,
  recentBlockhash: string,
  useBundle = true,
  tipLamports = 100_000,
) {
  // TODO: rewrite sending bundle logic by jito sdk
  const blockEngineUrl = jitoBaseUrls[JitoRegion.Tokyo];
  // const c = searcher.searcherClient(blockEngineUrl);
  if (useBundle) {
    const tipAccount = new PublicKey(
      "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
    );
    const tipIx = SystemProgram.transfer({
      fromPubkey: feePayer.publicKey,
      toPubkey: tipAccount,
      lamports: tipLamports,
    });

    const instructions = [tipIx];

    const messageV0 = new TransactionMessage({
      payerKey: feePayer.publicKey,
      recentBlockhash,
      instructions,
    }).compileToV0Message();

    const tipTx = new VersionedTransaction(messageV0);

    tipTx.sign([feePayer]);
    const request = {
      jsonrpc: "2.0",
      id: 1,
      method: "sendBundle",
      params: [[bs58.encode(rawTransaction), bs58.encode(tipTx.serialize())]],
    };
    const { data } = await axios.post(
      `${blockEngineUrl}/api/v1/bundles`,
      JSON.stringify(request),
      {
        headers: { "Content-Type": "application/json" },
      },
    );
    return data;
  } else {
    const request = {
      jsonrpc: "2.0",
      id: 1,
      method: "sendTransaction",
      params: [bs58.encode(rawTransaction)],
    };
    const { data } = await axios.post(
      `${blockEngineUrl}/transactions`,
      JSON.stringify(request),
      {
        headers: { "Content-Type": "application/json" },
        params: {
          bundleOnly: true,
        },
      },
    );
    return data;
  }
}

export async function sendTransaction(
  connection: Connection,
  transaction: VersionedTransaction,
  signers: Keypair[],
  updateBlockHash = true,
  useJito = false,
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
  // calc txid instead of returned value from rpc call
  const txid = bs58.encode(transaction.signatures[0]);
  if (useJito) {
    await sendTransactionByJito(
      signers[0],
      rawTransaction,
      transaction.message.recentBlockhash,
      true,
    );
  } else {
    await connection.sendRawTransaction(rawTransaction, {
      skipPreflight: true,
      maxRetries: 10,
    });
  }
  return txid;
}

export async function estimateUnitLimit(
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

export function decodePriorityFee(message: TransactionMessage) {
  let unitLimit = undefined,
    unitPrice = undefined;
  for (const instruction of message.instructions) {
    if (instruction.programId.equals(ComputeBudgetProgram.programId)) {
      const discriminator = instruction.data[0];
      switch (discriminator) {
        case 2: {
          if (unitLimit !== undefined) {
            throw new Error(`duplicated compute unit limit ix`);
          }
          unitLimit = borsh.deserialize(
            { struct: { discriminator: "u8", units: "u32" } },
            Buffer.from(instruction.data),
          );
          break;
        }
        case 3: {
          if (unitPrice !== undefined) {
            throw new Error(`duplicated compute unit price ix`);
          }
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

export async function printPriorityFee(
  transaction: VersionedTransaction,
  connection: Connection,
) {
  const addressLookupTableAccounts = await parseLUT(transaction, connection);
  const message = TransactionMessage.decompile(transaction.message, {
    addressLookupTableAccounts,
  });

  console.log("priorityFee: ", decodePriorityFee(message));
}

export async function parseLUT(
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
  return addressLookupTableAccounts;
}

export async function clearPriorityFee(
  transaction: VersionedTransaction,
  connection: Connection,
) {
  const addressLookupTableAccounts = await parseLUT(transaction, connection);
  const message = TransactionMessage.decompile(transaction.message, {
    addressLookupTableAccounts,
  });
  message.instructions = message.instructions.filter(
    (ix) => !ix.programId.equals(ComputeBudgetProgram.programId),
  );
  transaction.message = message.compileToV0Message(addressLookupTableAccounts);
}

// adjust message in version transaction
export async function setPriorityFee(
  params: {
    unitPrice?: number;
    unitLimit?: number;
  },
  transaction: VersionedTransaction,
  connection: Connection,
) {
  const addressLookupTableAccounts = await parseLUT(transaction, connection);
  const message = TransactionMessage.decompile(transaction.message, {
    addressLookupTableAccounts: addressLookupTableAccounts,
  });

  console.log("before: ", decodePriorityFee(message));
  if (params.unitLimit === undefined) {
    let unitLimit = await estimateUnitLimit(transaction, connection);
    params.unitLimit = unitLimit === 0 ? 500000 : unitLimit;
  }

  if (params.unitPrice === undefined) {
    params.unitPrice = 1000000;
  }
  const limitIx = ComputeBudgetProgram.setComputeUnitLimit({
    units: params.unitLimit,
  });
  const priceIx = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: params.unitPrice,
  });

  let replaceUnitLimt = false;
  let replaceUnitPrice = false;
  for (let i = 0; i < message.instructions.length; ++i) {
    const instruction = message.instructions[i];
    if (instruction.programId.equals(ComputeBudgetProgram.programId)) {
      const discriminator = instruction.data[0];
      switch (discriminator) {
        case 2: {
          message.instructions[i] = limitIx;
          replaceUnitLimt = true;
          break;
        }
        case 3: {
          message.instructions[i] = priceIx;
          replaceUnitPrice = true;
          break;
        }
        default: {
          break;
        }
      }
    }
  }
  if (!replaceUnitPrice) {
    message.instructions = [priceIx, ...message.instructions];
  }
  if (!replaceUnitLimt) {
    message.instructions = [limitIx, ...message.instructions];
  }

  console.log("after: ", decodePriorityFee(message));
  transaction.message = message.compileToV0Message(addressLookupTableAccounts);
}
