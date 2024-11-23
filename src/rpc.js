import * as Namada from "@fadroma/namada";
import { readFile } from "node:fs/promises";
import { CHAIN_ID, RPC_URL } from './config.js';
import { filterBigInts } from './utils.js';

let rpc

export default function getRPC () {
  return rpc ??= rpcVariant(RPC_URL)
}

export async function rpcVariant (url) {
  const decoder = await readFile("node_modules/@fadroma/namada/pkg/fadroma_namada_bg.wasm")
  let connection
  while (true) {
    try {
      connection = await Namada.connect({ url, decoder })
      break
    } catch (e) {
      if (e.message === 'must provide a non-empty value') {
        console.error(`RPC empty response (${url}): node is starting`)
      } else if (e.cause) {
        console.error(`RPC connect failed (${url}): ${e.cause.name}: ${e.cause.message} (${e.cause.code})`)
      } else {
        console.error(`RPC connect failed (${url}):`, e)
      }
      await new Promise(resolve=>setTimeout(resolve, 1000))
    }
  }
  return connection
}

export async function rpcHeight (_, res) {
  const chain = await getRPC()
  res.status(200).send({
    timestamp: new Date().toISOString(),
    chainId:   CHAIN_ID,
    height:    await chain.fetchHeight()
  })
}

export async function rpcTotalStaked (_, res) {
  const chain = await getRPC()
  res.status(200).send({
    timestamp:   new Date().toISOString(),
    chainId:     CHAIN_ID,
    totalStaked: String(await chain.fetchTotalStaked())
  })
}

export async function rpcEpoch (_, res) {
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

export async function rpcStakingParameters (_, res) {
  const chain = await getRPC()
  const parameters = await chain.fetchStakingParameters();
  res.status(200).send(filterBigInts(parameters));
}

export async function rpcGovernanceParameters (_, res) {
  const chain = await getRPC();
  const parameters = await chain.fetchGovernanceParameters();
  res.status(200).send(filterBigInts(parameters));
}

export async function rpcPGFParameters (_, res) {
  const chain = await getRPC();
  const parameters = await chain.fetchPGFParameters();
  res.status(200).send(filterBigInts(parameters));
}

export async function rpcProtocolParameters (_, res) {
  const chain = await getRPC();
  const param = await chain.fetchProtocolParameters();
  res.status(200).send(filterBigInts(param));
}
