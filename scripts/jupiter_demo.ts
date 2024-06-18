import * as bs58 from "bs58";
import fetch from "node-fetch";
import JSBI from "jsbi";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { Jupiter, RouteInfo, TOKEN_LIST_URL, SwapResult } from "@jup-ag/core";
import dotenv from "dotenv";
dotenv.config();

export interface Token {
  chainId: number; // 101,
  address: string; // 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  symbol: string; // 'USDC',
  name: string; // 'Wrapped USDC',
  decimals: number; // 6,
  logoURI: string; // 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/BXXkv6z8ykpG1yuvUDPgh732wzVHB69RnB9YgSYh3itW/logo.png',
  tags: string[]; // [ 'stablecoin' ]
}

const INPUT_MINT_ADDRESS = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const OUTPUT_MINT_ADDRESS = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

const main = async () => {
  const ENV = "mainnet-beta";
  const connection = new Connection(
    process.env.SOLANA_RPC_ENDPOINT || "",
    "confirmed",
  );
  const tokens: Token[] = await (await fetch(TOKEN_LIST_URL[ENV])).json();

  // const WALLET_PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY || "PASTE YOUR WALLET PRIVATE KEY";
  // const USER_PRIVATE_KEY = bs58.decode(WALLET_PRIVATE_KEY);
  const USER_KEYPAIR = Keypair.fromSecretKey(
    bs58.decode(process.env.PRIVATE_KEY || ""),
  );

  /// load jupiter
  const jupiter = await Jupiter.load({
    connection,
    cluster: ENV,
    user: USER_KEYPAIR,
  });

  // get route info
  const routeMap = jupiter.getRouteMap();

  const getPossiblePairsTokenInfo = ({
    tokens,
    routeMap,
    inputToken,
  }: {
    tokens: Token[];
    routeMap: Map<string, string[]>;
    inputToken?: Token;
  }) => {
    try {
      const possiblePairs = routeMap.get(inputToken!.address)!;
      const possiblePairsTokenInfo: { [key: string]: Token | undefined } = {};
      possiblePairs.forEach((address) => {
        possiblePairsTokenInfo[address] = tokens.find((t) => {
          return t.address === address;
        });
      });
      return possiblePairsTokenInfo;
    } catch (error) {
      throw error;
    }
  };

  const inputToken = tokens.find((t) => t.address === INPUT_MINT_ADDRESS);
  const outputToken = tokens.find((t) => t.address === OUTPUT_MINT_ADDRESS);

  // fetch available tokens to swap with input token
  const possiblePairsTokenInfo = getPossiblePairsTokenInfo({
    inputToken,
    tokens,
    routeMap,
  });

  const routes = await jupiter.computeRoutes({
    inputMint: new PublicKey(INPUT_MINT_ADDRESS),
    outputMint: new PublicKey(OUTPUT_MINT_ADDRESS),
    amount: JSBI.BigInt(1000000),
    slippageBps: 5, // 0.05%
  });
  const bestRoute = routes.routesInfos[0];
  console.log(bestRoute);
  // const { execute } = await jupiter.exchange({
  // routeInfo: bestRoute
  // })

  // const swapResult: SwapResult = await execute();
  // if (swapResult.error) {
  // console.log(swapResult.error);
  // } else {
  // console.log(`https://explorer.solana.com/tx/${swapResult.txid}`);
  // console.log(`inputAddress=${swapResult.inputAddress.toString()} outputAddress=${swapResult.outputAddress.toString()}`);
  // console.log(`inputAmount=${swapResult.inputAmount} outputAmount=${swapResult.outputAmount}`);
  // }
};

main();
