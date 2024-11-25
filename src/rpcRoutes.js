import express from 'express'
import { CHAIN_ID } from './config.js'
import { withConsole } from './utils.js'
import { filterBigInts } from './utils.js';

// Routes that respond with data queried directly from RPC endpoints.
export const rpcRoutes = {}

rpcRoutes['/height'] = chain => async function multiRpcHeight (_) {
  return {
    chainId:   CHAIN_ID,
    rpcUrl:    chain.connections[0].url,
    timestamp: new Date().toISOString(),
    height:    String(await chain.fetchHeight())
  }
}

rpcRoutes['/total-staked'] = chain => async function multiRpcTotalStaked (_) {
  return {
    chainId:     CHAIN_ID,
    rpcUrl:      chain.connections[0].url,
    timestamp:   new Date().toISOString(),
    totalStaked: String(await chain.fetchTotalStaked())
  }
}

rpcRoutes['/epoch'] = chain => async function multiRpcEpoch (_) {
  const [epoch, firstBlock, duration] = await Promise.all([
    chain.fetchEpoch(),
    chain.fetchEpochFirstBlock(),
    chain.fetchEpochDuration(),
  ])
  return {
    timestamp:  new Date().toISOString(),
    chainId:    CHAIN_ID,
    rpcUrl:     chain.connections[0].url,
    epoch:      String(epoch),
    firstBlock: String(firstBlock),
    ...filterBigInts(duration)
  }
}

rpcRoutes['/parameters'] = chain => async function multiRpcProtocolParameters (_) {
  const parameters = await chain.fetchProtocolParameters();
  return {
    timestamp:   new Date().toISOString(),
    chainId:     CHAIN_ID,
    rpcUrl:      chain.connections[0].url,
    ...filterBigInts(parameters)
  }
}

rpcRoutes['/parameters/staking'] = chain => async function multiRpcStakingParameters (_) {
  const parameters = await chain.fetchStakingParameters();
  return {
    timestamp:   new Date().toISOString(),
    chainId:     CHAIN_ID,
    rpcUrl:      chain.connections[0].url,
    ...filterBigInts(parameters)
  }
}

rpcRoutes['/parameters/governance'] = chain => async function multiRpcGovernanceParameters (_) {
  const parameters = await chain.fetchGovernanceParameters();
  return {
    timestamp:   new Date().toISOString(),
    chainId:     CHAIN_ID,
    rpcUrl:      chain.connections[0].url,
    ...filterBigInts(parameters)
  }
}

rpcRoutes['/parameters/pgf'] = chain => async function multiRpcPGFParameters (_) {
  const parameters = await chain.fetchPGFParameters();
  return {
    timestamp:   new Date().toISOString(),
    chainId:     CHAIN_ID,
    rpcUrl:      chain.connections[0].url,
    ...filterBigInts(parameters)
  }
}

export default function getRpcRouter (rpcs) {
  return addRpcRoutes(express.Router(), rpcs)
}

export function addRpcRoutes (router, rpcs) {
  for (const [route, handler] of Object.entries(rpcRoutes)) {
    router.get(route, withConsole(async (req, res) => {
      let result
      try {
        result = await Promise.any(rpcs.map(rpc=>rpc.then(rpc=>handler(rpc)(req))))
      } catch (e) {
        console.error(e)
        res.status(500).send({ error: e.message })
      }
      res.status(200).send(result)
    }))
  }
  return router
}
