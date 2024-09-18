import * as Namada from "@fadroma/namada";
import { readFile } from "fs/promises";
import {
  CHAIN_ID,
  PRE_UNDEXER_RPC_URL,
  POST_UNDEXER_RPC_URL,
  NODE_LOWEST_BLOCK_HEIGHT
} from './config.js';

const rpcVariant = async url => {
  const decoder = await readFile("node_modules/@fadroma/namada/pkg/fadroma_namada_bg.wasm")
  let connection
  while (true) {
    try {
      connection = await Namada.connect({ url, decoder })
      break
    } catch (e) {
      if (e.cause?.code == 'ECONNREFUSED') {
        console.error(`ECONNREFUSED connecting to RPC ${url}; retrying in 1s`)
      } else if (e.message === 'must provide a non-empty value') {
        console.error(`Empty node status at RPC ${url}; retrying in 1s`)
      } else {
        console.error(e)
        console.error(`Failed to connect to RPC ${url}; retrying in 1s`)
      }
      await new Promise(resolve=>setTimeout(resolve, 1000))
    }
  }
  return connection
}

/** Map of first block number that uses a certain RPC URL
  * to a pair of { query, connection } objects that wrap the RPC. */
export const rpcs = toSortedRPCs({
  1: rpcVariant(PRE_UNDEXER_RPC_URL),
  [NODE_LOWEST_BLOCK_HEIGHT]: rpcVariant(POST_UNDEXER_RPC_URL),
})

/** Validate record of (first block number -> RPC) and
  * convert to list (latest first). */
function toSortedRPCs (rpcs) {
  const sortedRPCs = []
  const limits = new Set()
  for (const limit of Object.keys(rpcs)) {
    if (isNaN(Number(limit))) {
      throw new Error(`Non-number block limit ${limit}`)
    }
  }
  for (const limit of Object.keys(rpcs).sort((a,b)=>b-a)) {
    if (limits.has(Number(limit))) {
      throw new Error(`Duplicate block limit ${limit}`)
    }
    limits.add(Number(limit))
    sortedRPCs.push([Number(limit), rpcs[limit]])
  }
  return sortedRPCs
}

/** Iterate over list of (first block number, RPC)
  * and return the RPC corresponding to a given height */
export default function getRPC (height = Infinity) {
  for (const [limit, variant] of rpcs) {
    if (height >= limit) {
      return variant
    }
  }
  throw new Error(`Could not find suitable RPC for height ${height}`)
}

export async function rpcHeight (req, res) {
  const chain = await getRPC()
  res.status(200).send({
    timestamp: new Date().toISOString(),
    chainId:   CHAIN_ID,
    height:    await chain.fetchHeight()
  })
}

export async function rpcTotalStaked (req, res) {
  const chain = await getRPC()
  res.status(200).send({
    timestamp:   new Date().toISOString(),
    chainId:     CHAIN_ID,
    totalStaked: String(await chain.fetchTotalStaked())
  })
}

export async function rpcEpoch (req, res) {
  const chain = await getRPC()
  const [epoch, firstBlock, duration] = await Promise.all([
    chain.fetchEpoch(),
    chain.fetchEpochFirstBlock(),
    chain.fetchEpochDuration(),
  ])
  res.status(200).send(filterBigInts({
    timestamp:  new Date().toISOString(),
    chainId:    CHAIN_ID,
    epoch:      String(epoch),
    firstBlock: String(firstBlock),
    ...duration
  }))
}

export async function rpcStakingParameters (req, res) {
  const chain = await getRPC()
  const parameters = await chain.fetchStakingParameters();
  res.status(200).send(filterBigInts(parameters));
}

export async function rpcGovernanceParameters (req, res) {
  const chain = await getRPC();
  const parameters = await chain.fetchGovernanceParameters();
  res.status(200).send(filterBigInts(parameters));
}

export async function rpcPGFParameters (req, res) {
  const chain = await getRPC();
  const parameters = await chain.fetchPGFParameters();
  res.status(200).send(filterBigInts(parameters));
}

export async function rpcProtocolParameters (req, res) {
  const chain = await getRPC();
  const param = await chain.fetchProtocolParameters();
  res.status(200).send(filterBigInts(param));
}

const filterBigInts = obj => JSON.parse(
  JSON.stringify(obj, (k, v) => (typeof v === 'bigint') ? String(v) : v)
)
