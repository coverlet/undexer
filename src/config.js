#!/usr/bin/env node
import "dotenv/config"
export const DEFAULT_PAGE_SIZE  = process.env.DEFAULT_PAGE_SIZE || 25
export const CHAIN_ID           = process.env.CHAIN_ID          || 'housefire-cotton.d3c912fee7462'
export const DATABASE_USER      = process.env.DATABASE_USER     || 'postgres'
export const DATABASE_PASS      = process.env.DATABASE_PASS     || 'insecure'
export const DATABASE_HOST      = process.env.DATABASE_HOST     || 'localhost'
export const DATABASE_PORT      = process.env.DATABASE_PORT     || '5432'
export const DATABASE_NAME      = process.env.DATABASE_NAME     || CHAIN_ID
export const DATABASE_URL       = process.env.DATABASE_URL      || `postgres://${DATABASE_USER}:${DATABASE_PASS}@${DATABASE_HOST}:${DATABASE_PORT}/${DATABASE_NAME}`
export const NODE_CONTROL_URL   = process.env.CONTROL_URL       || 'http://node:25551'
export const PROXY_CONTROL_URL  = process.env.CONTROL_URL       || 'http://node-out:25552'
export const RPC_URL            = process.env.RPC_URL           || 'http://node-in:26657'
/// Don't reset the indexing node from scratch if more than 2 epochs out of sync
export const ALLOW_INCOMPLETE   = Boolean(process.env.ALLOW_INCOMPLETE) || false
/// Start indexing from this block
export const START_BLOCK        = BigInt(process.env.START_BLOCK || 1)
/// Force truncate the database on start (`db.sync({ force: true })`)
export const START_FROM_SCRATCH = process.env.START_FROM_SCRATCH || false

export const GOVERNANCE_TRANSACTIONS = [
  "tx_vote_proposal.wasm",
  "tx_init_proposal.wasm"
]

const token = (address, symbol, coin) => ({address, symbol, coin})
export const TOKENS = [
  token("tnam1qy440ynh9fwrx8aewjvvmu38zxqgukgc259fzp6h", "NAM", "Namada"),
  token("tnam1qyzv6anc548dyj0nqvezrxxd6679d0a02y78k3xx", "DOT", "Polkadot"),
  token("tnam1q9046ls453j29xp0g90vm05dpped9adweyjnplkl", "ETH", "Ethereum"),
  token("tnam1qy4u69pe54hyssg9g42equq0z2vrj9rlnsrfcu6l", "BTC", "Bitcoin"),
  token("tnam1qxkdfqv2shgyllcf7dq5qlvf8gt6a2kr0s33ye26", "SCH", "Schnitzel"),
  token("tnam1qy4pd2j2wkp34c49epd5wy9ny83qsedekgac6gyr", "APF", "Apfel"),
  token("tnam1q982u50dxneydrlne6nfhrcwxc5mlxtpssjjdp3q", "KAR", "Kartoffel")
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
    NODE_CONTROL_URL,
    PROXY_CONTROL_URL,
    RPC_URL,
    ALLOW_INCOMPLETE,
    START_BLOCK,
    START_FROM_SCRATCH,
  })
}
