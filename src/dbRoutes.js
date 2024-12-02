import express from 'express'
import { literal } from 'sequelize';
import * as DB from './db.js';
import * as RPC from './rpc.js';
import * as Query from './dbQuery.js';
import { TOKENS, CHAIN_ID } from './config.js';
import { pagination, relativePagination, withConsole } from './utils.js';

const chainId = CHAIN_ID

// Routes that respond with indexed data from the database.
export const dbRoutes = {}

dbRoutes['/'] = async function dbOverview (_req, res) {
  const timestamp = new Date().toISOString()
  const overview = await Query.overview()
  res.status(200).send({ timestamp, chainId, ...overview })
}

dbRoutes['/epochs'] = async function dbEpochs (req, res) {
  const timestamp = new Date().toISOString()
  const { limit, before, after } = relativePagination(req)
  if (before && after) {
    return res.status(400).send({ error: "Don't use before and after together" })
  }
  const epochs = await Query.epochs({ limit, before, after })
  res.status(200).send({ timestamp, epochs })
}

dbRoutes['/status'] = async function dbStatus (_req, res) {
  const timestamp = new Date().toISOString()
  const status = await Query.status()
  res.status(200).send({ timestamp, chainId, ...status })
}

dbRoutes['/search'] = async function dbStatus (_req, res) {
  const timestamp = new Date().toISOString()
  const status = await Query.status()
  res.status(200).send({ timestamp, chainId, ...status })
}

dbRoutes['/status'] = async function dbStatus (_req, res) {
  const timestamp = new Date().toISOString()
  const status = await Query.status()
  res.status(200).send({ timestamp, chainId, ...status })
}

dbRoutes['/blocks'] = async function dbBlocks (req, res) {
  const timestamp = new Date().toISOString()
  const { limit, before, after } = relativePagination(req)
  if (before && after) {
    return res.status(400).send({ error: "Don't use before and after together" })
  }
  const query = { before, after, limit, publicKey: req?.query?.publicKey }
  const results = await Query.blocks(query)
  res.status(200).send({ timestamp, chainId, ...results })
}

dbRoutes['/block'] = async function dbBlock (req, res) {
  const timestamp = new Date().toISOString()
  const _attrs = /*FIXME*/ Query.defaultAttributes(['blockHeight', 'blockHash', 'blockHeader', 'blockData'])
  const { height, hash } = req.query
  const block = await Query.block({ height, hash })
  if (!block) {
    return res.status(404).send({ error: 'Block not found' })
  }
  const transactions = await Query.transactionsAtHeight(block.blockHeight)
  const signers = block.blockData.result.block.last_commit.signatures.map(s=>s.validator_address)
  return res.status(200).send({
    timestamp,
    chainId,
    blockHeight:      block.blockHeight,
    blockHash:        block.blockHash,
    blockTime:        block.blockTime,
    epoch:            block.epoch,
    transactionCount: transactions.count,
    transactions:     transactions.rows.map(row => row.toJSON()),
    proposer: await Query.validatorByConsensusAddress(
      block.blockHeader.proposerAddress
    ),
    signers:  await Promise.all(signers.filter(Boolean).map(
      signer=>Query.validatorByConsensusAddress(signer)
    )),
  })
}

dbRoutes['/txs'] = async function dbTransactions (req, res) {
  const timestamp = new Date().toISOString()
  const { rows, count } = await Query.transactionList(pagination(req))
  res.status(200).send({ timestamp, chainId, count, txs: rows })
} 

dbRoutes['/tx/:txHash'] = async function dbTransaction (req, res) {
  const tx = await Query.transactionByHash(req.params.txHash);
  if (tx === null) return res.status(404).send({ error: 'Transaction not found' });
  res.status(200).send(tx);
}

dbRoutes['/validators'] = async function dbValidators (req, res) {
  const { limit, offset } = pagination(req)
  const epoch = await Query.latestEpochForValidators(req?.query?.epoch)
  const { state } = req.query
  const where = { epoch }
  if (state) where['state.state'] = state
  const order = [literal('"stake" collate "numeric" DESC')]
  const attrs = Query.defaultAttributes({ exclude: ['id'] })
  const { count, rows: validators } = await DB.Validator.findAndCountAll({
    where, order, limit, offset, attributes: attrs
  });
  const result = { count, validators: validators.map(v=>v.toJSON()) };
  res.status(200).send(result);
}

dbRoutes['/validators/states'] = async function dbValidatorStates (req, res) {
  const epoch = await Query.latestEpochForValidators(req?.query?.epoch)
  const states = {}
  for (const validator of await DB.Validator.findAll({
    where: { epoch },
    attributes: { include: [ 'state' ] }
  })) {
    states[validator?.state?.state] ??= 0
    states[validator?.state?.state] ++
  }
  res.status(200).send(states)
}

dbRoutes['/validator'] = async function dbValidatorByHash (req, res) {
  const epoch = await Query.latestEpochForValidators(req?.query?.epoch)
  const publicKey = req.query.publicKey
  const namadaAddress = req.query.address
  if (publicKey && namadaAddress) {
    return res.status(400).send({ error: "Don't use address and publicKey together" })
  }
  const where = { ...(namadaAddress? { namadaAddress }: { publicKey }), epoch }
  const attrs = Query.defaultAttributes({ exclude: ['id'] })
  let validator = await DB.Validator.findOne({ where, attributes: attrs });
  if (validator === null) {
    return res.status(404).send({ error: 'Validator not found' })
  }
  validator = { ...validator.get() }
  validator.metadata ??= {}
  const consensusAddresses = namadaAddress
    ? await Query.validatorNamadaAddressToConsensusAddresses(namadaAddress)
    : await Query.validatorPublicKeyToConsensusAddresses(publicKey)
  const lastSignedBlocks = []
  let uptime, currentHeight, countedBlocks
  if ('uptime' in req.query) {
    // Count number of times the validator's consensus address is encountered
    // in the set of all signatures belonging to the past 100 blocks.
    // This powers the uptime blocks visualization in the validator detail page.
    const order = [['blockHeight', 'DESC']]
    const limit = Math.min(1000, Number(req.query.uptime)||100);
    const attributes = ['blockHeight', 'blockData']
    const latestBlocks = await DB.Block.findAll({ order, limit, attributes })
    currentHeight = latestBlocks[0].height;
    countedBlocks = latestBlocks.length;
    for (const {
      blockHeight,
      blockData = { result: { block: { last_commit: { signatures: [] } } } }
    } of latestBlocks) {
      let present = false
      for (const { validator_address } of blockData.result.block.last_commit.signatures) {
        if (consensusAddresses.has(validator_address)) {
          present = true
          break
        }
      }
      if (present) {
        lastSignedBlocks.push(blockHeight)
        uptime++
      }
    }
  }
  res.status(200).send({
    currentHeight,
    ...validator,
    uptime,
    lastSignedBlocks,
    countedBlocks,
  });
}

dbRoutes['/validator/votes/:address'] = async function dbValidatorVotes (req, res) {
  const { limit, offset } = pagination(req);
  const where = { validator: req.params.address };
  const order = [['proposal', 'DESC']]
  const attrs = Query.defaultAttributes();
  const { count, rows } = await DB.Vote.findAndCountAll({
    limit, offset, where, attributes: attrs, order
  });
  res.status(200).send({ count, votes: rows });
}

dbRoutes['/proposals'] = async function dbProposals (req, res) {
  const { limit, offset } = pagination(req)
  const orderBy = req.query.orderBy ?? 'id';
  const orderDirection = req.query.orderDirection ?? 'DESC'
  const where = {}
  const { proposalType, status, result } = req.query
  if (proposalType) where.proposalType = proposalType
  if (status) where.status = status
  if (result) where.result = result
  const order = [[orderBy, orderDirection]]
  const attrs = Query.defaultAttributes()
  const { rows, count } = await DB.Proposal.findAndCountAll({
    order, limit, offset, where, attributes: attrs
  });
  res.status(200).send({
    count, proposals: rows
  })
}

dbRoutes['/proposals/stats'] = async function dbProposalStats (_req, res) {
  const [all, ongoing, upcoming, finished, passed, rejected] = await Promise.all([
    DB.Proposal.count(),
    DB.Proposal.count({ where: { 'metadata.status': 'ongoing'  } }),
    DB.Proposal.count({ where: { 'metadata.status': 'upcoming' } }),
    DB.Proposal.count({ where: { 'metadata.status': 'finished' } }),
    DB.Proposal.count({ where: { 'result.result':   'Passed'   } }),
    DB.Proposal.count({ where: { 'result.result':   'Rejected' } }),
  ])
  res.status(200).send({ all, ongoing, upcoming, finished, passed, rejected })
}

dbRoutes['/proposal/:id'] = async function dbProposal (req, res) {
  const id = req.params.id
  const result = await DB.Proposal.findOne({ where: { id }, attributes: Query.defaultAttributes(), });
  return result
    ? res.status(200).send(result.get())
    : res.status(404).send({ error: 'Proposal not found' });
}

dbRoutes['/proposal/votes/:id'] = async function dbProposalVotes (req, res) {
  const { limit, offset } = pagination(req);
  const where = { proposal: req.params.id };
  const attrs = Query.defaultAttributes();
  const { count, rows } = await DB.Vote.findAndCountAll({
    limit, offset, where, attributes: attrs,
  });
  res.status(200).send({ count, votes: rows });
}

dbRoutes['/transfers'] = async function dbTransfers (req, res) {
  const { limit, offset } = pagination(req)
  const { address, source, target } = req.query
  const [count, transfers] = await Promise.all([
    Query.transferCount({ address, source, target }),
    Query.transferList({ address, source, target, limit, offset }),
  ])
  res.status(200).send({ count, transfers })
}

dbRoutes['/transactions/:address'] = async function dbTransactionsForAddress (req, res) {
  const { address } = req.params;
  const { limit, offset } = pagination(req)
  try {
    const [count, transactions] = await Promise.all([
      Query.txWithAddressCount({ address }),
      Query.txWithAddressList({ address, limit, offset }),
    ])
    res.status(200).send({ count, transactions });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).send({ error: 'Failed to fetch transactions' });
  }
}

dbRoutes['/balances/:address'] = async function dbBalances (req, res) {
  const { address } = req.params;
  try {
    const chain = await RPC.default();
    const tokens = TOKENS.map(token=>token.address);
    const balances = await chain.fetchBalance(address, tokens);
    res.status(200).send({ balances: balances[address] });
  } catch (error) {
    console.error('Error fetching balances:', error);
    res.status(500).send({ error: 'Failed to fetch balances' });
  }
}

export default function getDbRouter () {
  return addDbRoutes(express.Router())
}

export function addDbRoutes (router) {
  for (const [route, handler] of Object.entries(dbRoutes)) {
    router.get(route, withConsole(handler))
  }
  return router
}
