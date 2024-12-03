import express from 'express'
import { literal } from 'sequelize';
import * as DB from './db.js';
import * as Query from './dbQuery.js';
import { CHAIN_ID } from './config.js';
import { pagination, relativePagination, withConsole } from './utils.js';

const chainId = CHAIN_ID

const send200 = (res, data)  => res.status(200).send(data)
const send400 = (res, error) => res.status(400).send({ error })
const send404 = (res, error) => res.status(404).send({ error })
const send500 = (res, error) => res.status(500).send({ error })

// Routes that respond with indexed data from the database.
export const dbRoutes = {}

dbRoutes['/'] = async function dbOverview (_req, res) {
  const timestamp = new Date().toISOString()
  const overview = await Query.overview()
  return send200(res, { timestamp, chainId, ...overview })
}

dbRoutes['/epochs'] = async function dbEpochs (req, res) {
  const timestamp = new Date().toISOString()
  const { limit, before, after } = relativePagination(req)
  if (before && after) {
    return send400(res, "Mutually exclusive query parameters: before, after")
  }
  const epochs = await Query.epochs({ limit, before, after })
  return send200(res, { timestamp, epochs })
}

dbRoutes['/status'] = async function dbStatus (_req, res) {
  const timestamp = new Date().toISOString()
  const status = await Query.status()
  return send200(res, { timestamp, chainId, ...status })
}

dbRoutes['/search'] = async function dbStatus (req, res) {
  const timestamp = new Date().toISOString()
  const { blocks, transactions, proposals } = await Query.search(req.query.q)
  return send200(res, { timestamp, chainId, blocks, transactions, proposals })
}

dbRoutes['/blocks'] = async function dbBlocks (req, res) {
  const timestamp = new Date().toISOString()
  const { limit, before, after } = relativePagination(req)
  if (before && after) {
    return send400(res, "Mutually exclusive query parameters: before, after")
  }
  const query = { before, after, limit, publicKey: req?.query?.publicKey }
  if (req?.query?.publicKey) {
    query.publicKey = req.query.publicKey
  }
  const results = await Query.blocks(query)
  return send200(res, { timestamp, chainId, ...results })
}

dbRoutes['/block'] = async function dbBlock (req, res) {
  const timestamp = new Date().toISOString()
  const _attrs = /*FIXME*/ Query.defaultAttributes(['blockHeight', 'blockHash', 'blockHeader', 'blockData'])
  const { height, hash } = req.query
  const block = await Query.block({ height, hash })
  if (!block) {
    return send404(res, 'Block not found')
  }
  const transactions = await Query.transactionsAtHeight(block.blockHeight)
  const signers = block.blockData.result.block.last_commit.signatures.map(s=>s.validator_address)
  const [proposerInfo, signersInfo] = await Promise.all([
    Query.validatorByConsensusAddress(
      block.blockHeader.proposerAddress
    ),
    Promise.all(signers.filter(Boolean).map(
      signer=>Query.validatorByConsensusAddress(signer)
    ))
  ])
  return send200(res, {
    timestamp,
    chainId,
    blockHeight:      block.blockHeight,
    blockHash:        block.blockHash,
    blockTime:        block.blockTime,
    epoch:            block.epoch,
    transactionCount: transactions.count,
    transactions:     transactions.rows.map(row => row.toJSON()),
    proposer:         proposerInfo,
    signers:          signersInfo,
  })
}

dbRoutes['/txs'] = async function dbTransactions (req, res) {
  const timestamp = new Date().toISOString()
  const { rows, count } = await Query.transactionList(pagination(req))
  return send200(res, { timestamp, chainId, count, txs: rows })
} 

dbRoutes['/tx/:txHash'] = async function dbTransaction (req, res) {
  const txHash = req?.params?.txHash
  if (!txHash) {
    return send400(res, 'Missing URL parameter: txHash')
  }
  const tx = await Query.transactionByHash(req.params.txHash);
  if (tx === null) {
    return send404(res, 'Transaction not found');
  }
  return send200(res, tx)
}

dbRoutes['/validators'] = async function dbValidators (req, res) {
  const { limit, offset } = pagination(req)
  const epoch = await Query.latestEpochFromValidators(req?.query?.epoch)
  const { state } = req.query
  const where = {}
  if (!isNaN(epoch)) where['epoch'] = epoch
  if (state) where['state.state'] = state
  const order = [literal('"stake" collate "numeric" DESC')]
  const attrs = Query.defaultAttributes({ exclude: ['id'] })
  const { count, rows: validators } = await DB.Validator.findAndCountAll({
    where, order, limit, offset, attributes: attrs
  });
  const result = { count, validators: validators.map(v=>v.toJSON()) };
  return send200(res, result);
}

dbRoutes['/validators/states'] = async function dbValidatorStates (req, res) {
  const epoch = await Query.latestEpochFromValidators(req?.query?.epoch)
  const states = {}
  const where = {}
  if (!isNaN(epoch)) where['epoch'] = epoch
  for (const validator of await DB.Validator.findAll({
    where, attributes: { include: [ 'state' ] }
  })) {
    states[validator?.state?.state] ??= 0
    states[validator?.state?.state] ++
  }
  return send200(res, states)
}

dbRoutes['/validator'] = async function dbValidatorByHash (req, res) {
  const epoch = await Query.latestEpochFromValidators(req?.query?.epoch)
  const publicKey = req?.query?.publicKey
  const namadaAddress = req?.query?.address
  if (publicKey && namadaAddress) {
    return send400(res, "Mutually exclusive query parameters: address, publicKey")
  }
  if (!(publicKey || namadaAddress)) {
    return send400(res, "Missing query parameter: address or publicKey")
  }
  const where = {}
  if (namadaAddress) where.namadaAddress = namadaAddress
  if (publicKey) where.publicKey = publicKey
  if (!isNaN(epoch)) where['epoch'] = epoch
  const attrs = Query.defaultAttributes({ exclude: ['id'] })
  let validator = await DB.Validator.findOne({ where, attributes: attrs });
  if (validator === null) {
    return send404(res, 'Validator not found')
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
  return send200(res, { currentHeight, ...validator, uptime, lastSignedBlocks, countedBlocks });
}

dbRoutes['/validator/votes/:address'] = async function dbValidatorVotes(req, res) {
  const { limit, offset } = pagination(req);
  const includeDelegated = req.query.delegated && req.query.delegated === 'true'
  if (!req?.params?.address) {
    return send400(res, 'Missing URL parameter: address')
  }
  const where = { validator: req.params.address }
  if (!includeDelegated) where.isValidator = true
  const order = [['proposal', 'DESC']]
  const attrs = Query.defaultAttributes();
  const { count, rows } = await DB.Vote.findAndCountAll({
    limit, offset, where, attributes: attrs, order
  });
  return send200(res, { count, votes: rows });
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
  return send200(res, { count, proposals: rows })
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
  return send200(res, { all, ongoing, upcoming, finished, passed, rejected })
}

dbRoutes['/proposal/:id'] = async function dbProposal (req, res) {
  if (!req?.params?.id) {
    return send400(res, 'Missing URL parameter: id')
  }
  const id = req.params.id
  const result = await DB.Proposal.findOne({ where: { id }, attributes: Query.defaultAttributes(), });
  return result ? send200(res, result.get()) : send404(res, 'Proposal not found');
}

dbRoutes['/proposal/votes/:id'] = async function dbProposalVotes (req, res) {
  if (!req?.params?.id) {
    return send400(res, 'Missing URL parameter: id')
  }
  const { limit, offset } = pagination(req);
  const where = { proposal: req.params.id };
  const attrs = Query.defaultAttributes();
  const { count, rows } = await DB.Vote.findAndCountAll({
    limit, offset, where, attributes: attrs,
  });
  return send200(res, { count, votes: rows });
}

dbRoutes['/transfers'] = async function dbTransfers (req, res) {
  const { limit, offset } = pagination(req)
  const { address, source, target } = req.query
  const [count, transfers] = await Promise.all([
    Query.transferCount({ address, source, target }),
    Query.transferList({ address, source, target, limit, offset }),
  ])
  return send200(res, { count, transfers })
}

dbRoutes['/transactions/:address'] = async function dbTransactionsForAddress (req, res) {
  if (!req?.params?.address) {
    return send400(res, 'Missing URL parameter: address')
  }
  const { address } = req.params;
  const { limit, offset } = pagination(req)
  try {
    const [count, transactions] = await Promise.all([
      Query.txWithAddressCount({ address }),
      Query.txWithAddressList({ address, limit, offset }),
    ])
    return send200(res, { count, transactions });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    return send500(res, 'Failed to fetch transactions');
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
