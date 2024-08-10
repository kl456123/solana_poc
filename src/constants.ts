export enum JitoRegion {
  Tokyo,
  NewYork,
  Frankfurt,
  Amsterdam,
  World,
}

export const jitoBaseUrls: { [key in JitoRegion]: string } = {
  [JitoRegion.Amsterdam]: "https://amsterdam.mainnet.block-engine.jito.wtf",
  [JitoRegion.Tokyo]: "https://tokyo.mainnet.block-engine.jito.wtf",
  [JitoRegion.NewYork]: "https://ny.mainnet.block-engine.jito.wtf",
  [JitoRegion.Frankfurt]: "https://frankfurt.mainnet.block-engine.jito.wtf",
  [JitoRegion.World]: "https://mainnet.block-engine.jito.wtf",
};
