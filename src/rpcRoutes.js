import express from 'express'
import { withConsole, filterBigInts, send200, send400, send500 } from './utils.js';
import { TOKENS } from './config.js';

// Routes that respond with data queried directly from RPC endpoints.
export const rpcRoutes = {}

const rpcResponseMeta = chain => ({
  timestamp: new Date().toISOString(), chainId: chain.id, rpcUrl: chain.connections[0].url,
})

rpcRoutes['/height'] = chain => async function multiRpcHeight (_) {
  return { ...rpcResponseMeta(chain), height: String(await chain.fetchHeight()) }
}

rpcRoutes['/total-staked'] = chain => async function multiRpcTotalStaked (req) {
  const { epoch = null } = req?.query ?? {}
  return { ...rpcResponseMeta(chain), totalStaked: String(await chain.fetchTotalStaked(epoch)) }
}


rpcRoutes['/epoch'] = chain => async function multiRpcEpoch (_) {
  const [epoch, firstBlock, duration] = await Promise.all([
    chain.fetchEpoch(),
    chain.fetchEpochFirstBlock(),
    chain.fetchEpochDuration(),
  ])
  return {
    ...rpcResponseMeta(chain),
    epoch:      String(epoch),
    firstBlock: String(firstBlock),
    ...duration
  }
}

rpcRoutes['/parameters'] = chain => async function multiRpcProtocolParameters (_) {
  return { ...rpcResponseMeta(chain), ...await chain.fetchProtocolParameters() }
}

rpcRoutes['/parameters/staking'] = chain => async function multiRpcStakingParameters (_) {
  return { ...rpcResponseMeta(chain), ...await chain.fetchStakingParameters() }
}

rpcRoutes['/parameters/governance'] = chain => async function multiRpcGovernanceParameters (_) {
  return { ...rpcResponseMeta(chain), ...await chain.fetchGovernanceParameters() }
}

rpcRoutes['/parameters/pgf'] = chain => async function multiRpcPGFParameters (_) {
  return { ...rpcResponseMeta(chain), ...await chain.fetchPGFParameters() }
}

rpcRoutes['/denomination/:token'] = chain => async function multiRpcTokenDenomination (req) {
  return { ...rpcResponseMeta(chain), ...await chain.fetchDenomination(req.params.token) }
}

rpcRoutes['/total-supply/:token'] = chain => async function multiRpcTokenDenomination (req) {
  return { ...rpcResponseMeta(chain), totalSupply: await chain.fetchTotalSupply(req.params.token) }
}

rpcRoutes['/effective-native-supply'] = chain => async function multiRpcTokenDenomination (req) {
  return { ...rpcResponseMeta(chain), effectiveNativeSupply: await chain.fetchEffectiveNativeSupply() }
}

rpcRoutes['/staking-rewards-rate'] = chain => async function multiRpcTokenDenomination (req) {
  return { ...rpcResponseMeta(chain), ...await chain.fetchStakingRewardsRate() }
}

rpcRoutes['/balances/:address'] = chain => async function rpcBalances (req, _) {
  if (!req?.params?.address) {
    throw new Error('Missing URL parameter: address', { code: 400 });
  }
  const { address } = req.params;
  try {
    const tokens = TOKENS.map(token=>token.address);
    const balances = await chain.fetchBalance(address, tokens);
    return { balances: balances[address] }
  } catch (error) {
    console.error('Error fetching balances:', error);
    throw new Error('Failed to fetch balances');
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
        res.status(e.code||500).send({ error: e.message })
      }
      res.status(200).send(filterBigInts(result))
    }))
  }
  return router
}
