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
  SystemProgram,
} from "@solana/web3.js";
import * as borsh from "borsh";
import fetch from "cross-fetch";
import { Wallet } from "@project-serum/anchor";
import * as bs58 from "bs58";
import axios from "axios";
import { checkTxIds, saveTxIdsToFile } from "../src/utils";
import { jitoBaseUrl } from "../src/constants";
import dotenv from "dotenv";
dotenv.config();

// 0.00005 sol
const minPriorityFee = 100000000000;
// 0.0001 sol
const maxPriorityFee = 100000000000;
const estimateByApi = false;
const jupiter_api_url = "quote-api.jup.ag/v6";
const useJito = true;

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

async function printPriorityFee(
  transaction: VersionedTransaction,
  connection: Connection,
) {
  const addressLookupTableAccounts = await parseLUT(transaction, connection);
  const message = TransactionMessage.decompile(transaction.message, {
    addressLookupTableAccounts,
  });

  console.log("priorityFee: ", decodePriorityFee(message));
}

async function parseLUT(
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

async function clearPriorityFee(
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
async function setPriorityFee(
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

async function getTransaction(
  quoteResponse: {},
  userPublicKey: string,
  options:
    | {}
    | {
        prioritizationFeeLamports: number | "auto";
        dynamicComputeUnitLimit: boolean;
      },
): Promise<VersionedTransaction> {
  const data = JSON.stringify({
    // route from /quote api
    quoteResponse,
    // user public key to be used for the swap
    userPublicKey,
    // auto wrap and unwrap SOL. default is true
    wrapUnwrapSOL: true,
    ...options,
    // feeAccount is optional. Use if you want to charge a fee.  feeBps must have been passed in /quote API.
    // This is the ATA account for the output token where the fee will be sent to. If you are swapping from SOL->USDC then this would be the USDC ATA you want to collect the fee.
    // feeAccount: "fee_account_public_key"
  });

  const config = {
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

async function sendTransactionByApi(rawTransaction: Uint8Array) {
  const baseUrl = "http://10.100.112.186:9305/";
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

async function sendTransactionByJito(
  feePayer: Keypair,
  rawTransaction: Uint8Array,
  recentBlockhash: string,
  useBundle = true,
  tipLamports = 1_000,
) {
  const baseUrl = jitoBaseUrl;
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
      `${baseUrl}/bundles`,
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
      `${baseUrl}/transactions`,
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

async function sendTransaction(
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
      false,
    );
  } else {
    await connection.sendRawTransaction(rawTransaction, {
      skipPreflight: true,
      maxRetries: 10,
    });
  }
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
  const numTxs = 1;
  for (let i = 0; i < numTxs; ++i) {
    // skip any failure cases after retry multiple times
    try {
      const quoteRequestParams: any = {
        inputMint: "So11111111111111111111111111111111111111112",
        outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        amount: 10000000,
        restrictIntermediateTokens: true,
      };
      if (estimateByApi) {
        quoteRequestParams.autoSlippage = true;
      } else {
        quoteRequestParams.slippageBps = 100;
      }
      const route = await getQuote(quoteRequestParams);

      const option = estimateByApi
        ? {
            // prioritizationFeeLamports: "auto",
            prioritizationFeeLamports: {
              autoMultiplier: 2,
            },
            dynamicComputeUnitLimit: true,
          }
        : {};

      //////////////   get transaction to swap onchain ////////////////
      // get serialized transactions for the swap
      const transaction = await getTransaction(
        route,
        wallet.publicKey.toString(),
        option,
      );

      // set already in tx returned from jupiter api
      // NOTE(when enable jito, priority fee is not necessary)
      if (useJito) {
        // clean all ixs of ComputeBudgetProgram
        await clearPriorityFee(transaction, connection);
      } else if (!estimateByApi) {
        const unitPrice = 50_000;
        const unitLimit = undefined;
        await setPriorityFee({ unitPrice, unitLimit }, transaction, connection);
      } else {
        await printPriorityFee(transaction, connection);
      }

      await retry(
        async () => {
          const txId = await sendTransaction(
            connection,
            transaction,
            [wallet.payer],
            true,
            useJito,
          );
          console.log(`send tx with txId: ${txId}`);
          txIds.push(txId);
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
    } catch (e) {
      console.log(`skip failure case due to error: ${e}`);
    }
  }

  saveTxIdsToFile(txIds, true);
}

main();
