import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";

import dotenv from "dotenv";
dotenv.config();

async function main() {
  const ENV = "mainnet-beta";
  const rpc_urls = [
    "https://solana.twnodes.com/naas/session/ODc0ZTFiOTEtNDNhYi00OTI5LThkMzEtMTc4MWNhNGZlZGU3",
    "https://bold-flashy-water.solana-mainnet.quiknode.pro/201727fad75061d27afe142b1dc8f9924297b686",
  ];

  for (const rpc_url of rpc_urls) {
    console.log(`---------------------------`);
    const connection = new Connection(rpc_url, "confirmed");
    const slotNum1 = await connection.getSlot("processed");
    const slotNum2 = await connection.getSlot("confirmed");
    const slotNum3 = await connection.getSlot("finalized");
    console.log(`processed: ${slotNum1}`);
    console.log(`confirmed: ${slotNum2}`);
    console.log(`finalized: ${slotNum3}`);
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");
    console.log(`${blockhash}`);
    console.log(`block height: ${lastValidBlockHeight}`);
  }
}

main();
