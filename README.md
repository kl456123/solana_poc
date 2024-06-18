# solana poc

## install

```bash
yarn install

# fillup solana rpc url and private key(base58 format) in .env file
PRIVATE_KEY=xxx
SOLANA_RPC_ENDPOINT=https://xxx
```

## Run

```
# send some swap txs using jupiter api
yarn run test

# then check these tx status and calc failure rate
yarn run check
```
