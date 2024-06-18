import {
  Connection,
  Keypair,
  PublicKey,
  Message,
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
import { checkTxIds, saveTxIdsToFile } from "../src/utils";

import dotenv from "dotenv";
dotenv.config();

async function getPriorityFee(connection: Connection) {
  const publicKey = new PublicKey(
    "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
  );

  const config = {
    lockedWritableAccounts: [publicKey],
  };
  const prioritizationFeeObjects =
    await connection.getRecentPrioritizationFees(config);
  if (prioritizationFeeObjects.length === 0) {
    console.log("No prioritization fee data available.");
    return;
  }

  const slots = prioritizationFeeObjects
    .map((feeObject) => feeObject.slot)
    .sort((a, b) => a - b);
  // Extract slots range
  const slotsRangeStart = slots[0];
  const slotsRangeEnd = slots[slots.length - 1];
  // Filter out prioritization fees that are equal to 0 for other calculations
  const nonZeroFees = prioritizationFeeObjects
    .map((feeObject) => feeObject.prioritizationFee)
    .filter((fee) => fee !== 0);
  console.log(nonZeroFees);

  // Calculate the average of the non-zero fees
  const averageFeeExcludingZeros =
    nonZeroFees.length > 0
      ? Math.floor(
          nonZeroFees.reduce((acc, fee) => acc + fee, 0) / nonZeroFees.length,
        )
      : 0;
  console.log(
    `Slots examined for priority fees: ${prioritizationFeeObjects.length}`,
  );
  console.log(
    `Slots range examined from ${slotsRangeStart} to ${slotsRangeEnd}`,
  );
  console.log(
    "====================================================================================",
  );
  // You can use averageFeeIncludingZeros, averageFeeExcludingZeros, and medianFee in your transactions script
  console.log(
    ` 💰 Average Prioritization Fee (excluding slots with zero fees): ${averageFeeExcludingZeros} micro-lamports.`,
  );
}

async function estimatePriorityFees(
  connection: Connection,
  account: PublicKey,
  last_n_slot = 150,
) {
  const currentSlot = await connection.getSlot();
  const signatureInfos = await connection.getSignaturesForAddress(account, {
    minContextSlot: currentSlot - last_n_slot,
  });
  const transactionsResp = await connection.getTransactions(
    signatureInfos.map((item) => item.signature),
    { maxSupportedTransactionVersion: 0 },
  );
  const unitPrices = [];
  for (const txResp of transactionsResp) {
    if (!txResp) {
      continue;
    }
    // get address lookup table accounts
    const addressLookupTableAccounts = await Promise.all(
      txResp.transaction.message.addressTableLookups.map(async (lookup) => {
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
    const message = TransactionMessage.decompile(txResp.transaction.message, {
      addressLookupTableAccounts: addressLookupTableAccounts,
    });
    let unitPrice = 0;
    for (const ix of message.instructions) {
      if (ix.programId.equals(ComputeBudgetProgram.programId)) {
        if (ix.data[0] === 3) {
          // price
          unitPrice = (
            borsh.deserialize(
              { struct: { discriminator: "u8", microLamports: "u64" } },
              Buffer.from(ix.data),
            ) as any
          )["microLamports"];
        }
      }
    }
    unitPrices.push(unitPrice);
  }
  return unitPrices.sort();
}

async function main() {
  const connection = new Connection(
    process.env.SOLANA_RPC_ENDPOINT || "",
    "confirmed",
  );
  const account = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");

  const unitPrices = await estimatePriorityFees(connection, account, 10);
  console.log(unitPrices);
}

main();
