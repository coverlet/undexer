#!/usr/bin/env node
import "dotenv/config"
export const DEFAULT_PAGE_SIZE        = process.env.DEFAULT_PAGE_SIZE         || 25
export const CHAIN_ID                 = process.env.CHAIN_ID                  || 'housefire-reduce.e51ecf4264fc3'
export const DATABASE_USER            = process.env.DATABASE_USER             || 'postgres'
export const DATABASE_PASS            = process.env.DATABASE_PASS             || 'insecure'
export const DATABASE_HOST            = process.env.DATABASE_HOST             || 'localhost'
export const DATABASE_PORT            = process.env.DATABASE_PORT             || '5432'
export const DATABASE_NAME            = process.env.DATABASE_NAME             || CHAIN_ID
export const DATABASE_URL             = process.env.DATABASE_URL              || `postgres://${DATABASE_USER}:${DATABASE_PASS}@${DATABASE_HOST}:${DATABASE_PORT}/${DATABASE_NAME}`
export const CONTROL_URL              = process.env.CONTROL_URL               || 'ws://node-status:25555'
export const RPC_URL                  = process.env.RPC_URL                   || 'http://node-in:26657'
export const PRE_UNDEXER_RPC_URL      = process.env.PRE_UNDEXER_RPC_URL       || RPC_URL
export const POST_UNDEXER_RPC_URL     = process.env.POST_UNDEXER_RPC_URL      || RPC_URL
export const NODE_LOWEST_BLOCK_HEIGHT = process.env.NODE_LOWEST_BLOCK_HEIGHT  ?? 0; //237907
/// Don't reset the indexing node from scratch if more than 2 epochs out of sync
export const ALLOW_INCOMPLETE         = Boolean(process.env.ALLOW_INCOMPLETE) || false
/// Start indexing from this block
export const START_BLOCK              = BigInt(process.env.START_BLOCK || 1)
/// Force truncate the database on start (`db.sync({ force: true })`)
export const START_FROM_SCRATCH       = process.env.START_FROM_SCRATCH || false

export const GOVERNANCE_TRANSACTIONS = [
  "tx_vote_proposal.wasm",
  "tx_init_proposal.wasm"
]

export const TOKENS = [
  {
    "address": "tnam1qxgfw7myv4dh0qna4hq0xdg6lx77fzl7dcem8h7e",
    "symbol": "NAM",
    "coin": "Namada"
  },
  {
    "address": "tnam1qyfl072lhaazfj05m7ydz8cr57zdygk375jxjfwx",
    "symbol": "DOT",
    "coin": "Polkadot"
  },
  {
    "address": "tnam1qxvnvm2t9xpceu8rup0n6espxyj2ke36yv4dw6q5",
    "symbol": "ETH",
    "coin": "Ethereum"
  },
  {
    "address": "tnam1qy8qgxlcteehlk70sn8wx2pdlavtayp38vvrnkhq",
    "symbol": "BTC",
    "coin": "Bitcoin"
  },
  {
    "address": "tnam1q9f5yynt5qfxe28ae78xxp7wcgj50fn4syetyrj6",
    "symbol": "SCH",
    "coin": "Schnitzel"
  },
  {
    "address": "tnam1qyvfwdkz8zgs9n3qn9xhp8scyf8crrxwuq26r6gy",
    "symbol": "APF",
    "coin": "Apfel"
  },
  {
    "address": "tnam1qyx93z5ma43jjmvl0xhwz4rzn05t697f3vfv8yuj",
    "symbol": "KAR",
    "coin": "Kartoffel"
  }
]

import { fileURLToPath } from 'node:url'
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dbPass = DATABASE_PASS.replace(/./g, '*')
  console.log('Current configuration:', {
    DEFAULT_PAGE_SIZE,
    CHAIN_ID,
    DATABASE_USER,
    DATABASE_PASS: dbPass,
    DATABASE_HOST,
    DATABASE_PORT,
    DATABASE_NAME,
    DATABASE_URL: DATABASE_URL.replaceAll(DATABASE_PASS, dbPass),
    CONTROL_URL,
    RPC_URL,
    PRE_UNDEXER_RPC_URL,
    POST_UNDEXER_RPC_URL,
    NODE_LOWEST_BLOCK_HEIGHT,
    ALLOW_INCOMPLETE,
    START_BLOCK,
    START_FROM_SCRATCH,
  })
}
