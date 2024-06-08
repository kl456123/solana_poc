# solana poc


## install
```bash
yarn install
fillup solana rpc url and private key(base58 format) in .env file
```


## Run

```
# send some swap txs using jupiter api
yarn ts-node api_demo.ts

# then check these tx status and calc failure rate
yarn ts-node get_valid_tx.ts
```
