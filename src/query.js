import db from './db.js'
import * as DB from './db.js'
import { Sequelize, Op, QueryTypes } from "sequelize"
import { intoRecord } from '@hackbg/into'

export const totalTransactions = () =>
  DB.Transaction.count()

export const totalVotes = () =>
  DB.Vote.count()

export const totalProposals = () =>
  DB.Proposal.count()

export const totalBlocks = () =>
  DB.Block.count()

export const latestEpoch = () =>
  DB.Block.max('epoch')

export const latestBlock = () =>
  DB.Block.max('blockHeight')

export const oldestBlock = () =>
  DB.Block.min('blockHeight')

export const totalValidators = () =>
  DB.Validator.count()

export const overview = ({ limit = 10 } = {}) => intoRecord({
  totalBlocks,
  oldestBlock,
  latestBlock,
  latestBlocks: blocksLatest({ limit }).then(x=>x.rows),
  totalTransactions,
  latestTransactions: transactionsLatest({ limit }),
  totalValidators,
  topValidators: validatorsTop({ limit }),
  totalProposals,
  totalVotes,
})

export const status = () => intoRecord({
  totalBlocks,
  oldestBlock,
  latestBlock,
  totalTransactions,
  totalValidators,
  totalProposals,
  totalVotes,
})

export const search = async (q = '') => {
  q = String(q||'').trim()
  const [ blocks, transactions, proposals ] = await Promise.all([
    searchBlocks(q),
    searchTransactions(q),
    searchProposals(q),
  ])
  return { blocks, transactions, proposals }
}

export const searchBlocks = async blockHeight => {
  blockHeight = Number(blockHeight)
  if (isNaN(blockHeight)) return []
  return [
    await DB.Block.findOne({
      where:      { blockHeight },
      attributes: { exclude: [ 'createdAt', 'updatedAt' ] },
    })
  ]
}

export const searchProposals = async id => {
  id = Number(id)
  if (isNaN(id)) return []
  return [
    await DB.Proposal.findOne({
      where:      { id },
      attributes: { exclude: [ 'createdAt', 'updatedAt' ] },
    })
  ]
}

export const searchTransactions = async txHash => {
  if (!txHash) return []
  return [
    await DB.Transaction.findOne({
      where:      { txHash },
      attributes: { exclude: [ 'createdAt', 'updatedAt' ] },
    })
  ]
}

const BLOCK_LIST_ATTRIBUTES = [ 'blockHeight', 'blockHash', 'blockTime', 'epoch' ]

export const blocks = async ({
  before,
  after,
  limit = 15,
  publicKey
}) => {
  const [total, latest, oldest] =
    await Promise.all([totalBlocks(), latestBlock(), oldestBlock()])
  const { consensusAddress: address, pastConsensusAddresses } =
    await validatorPublicKeyToConsensusAddresses(publicKey)
  // TODO: use all past consensus addresses to filter block list for given validator
  if (publicKey && !address) {
    return {
      address: null,
      publicKey,
      ...await intoRecord({ totalBlocks, latestBlock, oldestBlock }),
      count: 0,
      blocks: []
    }
  }
  const { rows, count } =
    await (before ? blocksBefore({ before, limit, address }) :
           after  ? blocksAfter({ after, limit, address }) :
                   blocksLatest({ limit, address }))
  return {
    address,
    publicKey,
    ...await intoRecord({ totalBlocks, latestBlock, oldestBlock }),
    count,
    blocks: await Promise.all(rows.map(block=>DB.Transaction
      .count({ where: { blockHeight: block.blockHeight } })
      .then(transactionCount=>({ ...block.get(), transactionCount }))
    ))
  }
}

//
// select
//   ("rpcResponses"->'block'->'response'#>>'{}')::jsonb->'result'->'block'->'proposer_address'
// from blocks ...
//
// select
//   ("rpcResponses"->'block'->'response'#>>'{}')::jsonb->'result'->'block'->'last_commit'->'signatures'
// from blocks ...
//
  //console.log(req.query)
  //if (req.query.blocks) validator.latestBlocks = await DB.Block.findAll({
    //order: [['blockHeight', 'DESC']],
    //limit: 15,
    //where: { 'blockHeader.proposerAddress': validator.address },
    //attributes: Query.defaultAttributes({ include: ['blockHash', 'blockHeight', 'blockTime'] }),
  //})

export const blocksLatest = ({ limit, address }) =>
  DB.Block.findAndCountAll({
    attributes: BLOCK_LIST_ATTRIBUTES,
    order: [['blockHeight', 'DESC']],
    limit,
    where: Object.assign({},
      address ? { 'blockHeader.proposerAddress': address } : {})
  })

export const blocksBefore = ({ before, limit = 15, address }) =>
  DB.Block.findAndCountAll({
    attributes: BLOCK_LIST_ATTRIBUTES,
    order: [['blockHeight', 'DESC']],
    limit,
    where: Object.assign({ blockHeight: { [Op.lte]: before } },
      address ? { 'blockHeader.proposerAddress': address } : {})
  })

export const blocksAfter = ({ after, limit = 15, address }) =>
  DB.Block.findAndCountAll({
    attributes: BLOCK_LIST_ATTRIBUTES,
    order: [['blockHeight', 'ASC']],
    limit,
    where: Object.assign({ blockHeight: { [Op.gte]: after } },
      address ? { 'blockHeader.proposerAddress': address } : {})
  })

export const block = async ({ height, hash } = {}) => {
  const attrs = defaultAttributes(['blockHeight', 'blockHash', 'blockHeader', 'epoch'])
  let block
  if (height || hash) {
    const where = {}
    if (height) where['blockHeight'] = height
    if (hash) where['blockHash'] = hash
    block = await DB.Block.findOne({attributes: attrs, where})
  } else {
    const order = [['blockHeight', 'DESC']]
    block = await DB.Block.findOne({attributes: attrs, order})
  }
  return block
}

export const blockByHeightWithTransactions = (blockHeight = 0) => {
  const where = { blockHeight }
  return Promise.all([
    DB.Block.findOne({ where, attributes: defaultAttributes() }),
    DB.Transaction.findAndCountAll({ where, attributes: defaultAttributes() }),
  ])
}

export const epochs = ({ limit = 10, before, after }) =>
  before ? epochsBefore({ before, limit }) :
   after ? epochsAfter({ after, limit })   :
           epochsLatest({ limit })

export const epochsLatest = ({ limit = 10 }) => DB.Block.findAll({
  where: { "epoch": { [Op.not]: null } },
  attributes: [
    "epoch",
    [Sequelize.fn("MAX", Sequelize.col("blockHeight")), "maxBlockHeight"],
    [Sequelize.fn("MIN", Sequelize.col("blockHeight")), "minBlockHeight"],
  ],
  order: [['epoch', 'DESC']],
  group: "epoch",
  limit,
})

export const epochsBefore = ({ limit = 10, before }) => DB.Block.findAll({
  where: { "epoch": { [Op.not]: null, [Op.lte]: before } },
  attributes: [
    "epoch",
    [Sequelize.fn("MAX", Sequelize.col("blockHeight")), "maxBlockHeight"],
    [Sequelize.fn("MIN", Sequelize.col("blockHeight")), "minBlockHeight"],
  ],
  order: [['epoch', 'DESC']],
  group: "epoch",
  limit,
})

export const epochsAfter = ({ limit = 10, after }) => DB.Block.findAll({
  where: { "epoch": { [Op.not]: null, [Op.gte]: after } },
  attributes: [
    "epoch",
    [Sequelize.fn("MAX", Sequelize.col("blockHeight")), "maxBlockHeight"],
    [Sequelize.fn("MIN", Sequelize.col("blockHeight")), "minBlockHeight"],
  ],
  order: [['epoch', 'ASC']],
  group: "epoch",
  limit,
})

export const transactionByHash = txHash => {
  const where = { txHash };
  const attrs = defaultAttributes({ exclude: ['id'] })
  return DB.Transaction.findOne({ where, attrs });
}

export const transactionList = ({ limit, offset } = {}) =>
  DB.Transaction.findAndCountAll({
    attributes: defaultAttributes({ exclude: ['id'] }),
    order: [['txTime', 'DESC']],
    limit,
    offset,
  })

export const transactionsLatest = ({ limit = 15 } = {}) =>
  DB.Transaction.findAll({
    order: [['blockHeight', 'DESC']],
    limit,
    offset: 0,
    attributes: [
      'blockHeight',
      'blockHash',
      'blockTime',
      'txHash',
      'txTime',
      [db.json('txData.data.content.type'), 'txContentType']
    ],
  })

export const transactionsAtHeight = (blockHeight = 0) =>
  DB.Transaction.findAndCountAll({ where: { blockHeight } })

const toCount = query => query.then(query=>Number(query[0][0].count))

export const becomeValidatorCount = async ({ address = "" }) => await toCount(db.query(`
  SELECT COUNT(*) FROM "transactions"
  WHERE "txData"->'data'->'content'->'type' = '"tx_become_validator.wasm"'
  AND "txData"->'data'->'content'->'data'->'address' = :address
`, {
  replacements: { address: JSON.stringify(address), }
}))

export const becomeValidatorList = async ({
  address = "",
  limit   = 100,
  offset  = 0
}) => await db.query(`
  SELECT "blockHeight", "txHash", "txTime", "txData"->'data'->'content'->'data' as data
  FROM   "transactions"
  WHERE  "txData"->'data'->'content'->'type' = '"tx_become_validator.wasm"'
  AND    "txData"->'data'->'content'->'data'->'address' = :address
  ORDER BY "blockHeight" DESC LIMIT :limit OFFSET :offset
`, {
  type: QueryTypes.SELECT, replacements: {
    address: JSON.stringify(address),
    limit,
    offset,
  }
})

export const changeValidatorMetadataCount = async ({ validator = "" }) => await toCount(db.query(`
  SELECT COUNT(*) FROM "transactions"
  WHERE "txData"->'data'->'content'->'type' = '"tx_change_validator_metadata.wasm"'
  AND "txData"->'data'->'content'->'data'->'validator' = :validator
`, {
  replacements: { validator: JSON.stringify(validator), }
}))

export const changeValidatorMetadataList = async ({
  validator = "",
  limit   = 100,
  offset  = 0
}) => await db.query(`
  SELECT "blockHeight", "txHash", "txTime", "txData"->'data'->'content'->'data' as data
  FROM   "transactions"
  WHERE  "txData"->'data'->'content'->'type' = '"tx_change_validator_metadata.wasm"'
  AND    "txData"->'data'->'content'->'data'->'validator' = :validator
  ORDER BY "blockHeight" DESC LIMIT :limit OFFSET :offset
`, {
  type: QueryTypes.SELECT, replacements: {
    validator: JSON.stringify(validator),
    limit,
    offset,
  }
})

export const deactivateValidatorCount = async ({ address = "" }) => await toCount(db.query(`
  SELECT COUNT(*) FROM "transactions"
  WHERE "txData"->'data'->'content'->'type' = '"tx_deactivate_validator.wasm"'
  AND "txData"->'data'->'content'->'data'->'address' = :address
`, {
  replacements: { address: JSON.stringify(address), }
}))

export const deactivateValidatorList = async ({
  address = "",
  limit   = 100,
  offset  = 0
}) => await db.query(`
  SELECT "blockHeight", "txHash", "txTime", "txData"->'data'->'content'->'data' as data
  FROM   "transactions"
  WHERE  "txData"->'data'->'content'->'type' = '"tx_deactivate_validator.wasm"'
  AND    "txData"->'data'->'content'->'data'->'address' = :address
  ORDER BY "blockHeight" DESC LIMIT :limit OFFSET :offset
`, {
  type: QueryTypes.SELECT, replacements: {
    address: JSON.stringify(address),
    limit,
    offset,
  }
})

export const bondCount = async ({ source = "", validator = "" }) => await toCount(db.query(`
  SELECT COUNT(*) FROM "transactions"
  WHERE "txData"->'data'->'content'->'type' = '"tx_bond.wasm"'
  AND (
    "txData"->'data'->'content'->'data'->'source' = :source
    OR
    "txData"->'data'->'content'->'data'->'validator' = :validator
  )
`, {
  replacements: {
    source:    JSON.stringify(source),
    validator: JSON.stringify(validator)
  }
}))

export const bondList = async ({
  source    = "",
  validator = "",
  limit     = 100,
  offset    = 0
}) => await db.query(`
  SELECT "blockHeight", "txHash", "txTime", "txData"->'data'->'content'->'data' as data
  FROM   "transactions"
  WHERE  "txData"->'data'->'content'->'type' = '"tx_bond.wasm"'
  AND (
    "txData"->'data'->'content'->'data'->'source' = :source
    OR
    "txData"->'data'->'content'->'data'->'validator' = :validator
  )
  ORDER BY "blockHeight" DESC LIMIT :limit OFFSET :offset
`, {
  type: QueryTypes.SELECT, replacements: {
    source:    JSON.stringify(source),
    validator: JSON.stringify(validator),
    limit,
    offset
  }
})

export const unbondCount = async ({ source = "", validator = "" }) => await toCount(db.query(`
  SELECT COUNT(*) FROM "transactions"
  WHERE "txData"->'data'->'content'->'type' = '"tx_unbond.wasm"'
  AND (
    "txData"->'data'->'content'->'data'->'source' = :source
    OR
    "txData"->'data'->'content'->'data'->'validator' = :validator
  )
`, {
  replacements: {
    source:    JSON.stringify(source),
    validator: JSON.stringify(validator)
  }
}))

export const unbondList = async ({
  source    = "",
  validator = "",
  limit     = 100,
  offset    = 0
}) => await db.query(`
  SELECT "blockHeight", "txHash", "txTime", "txData"->'data'->'content'->'data' as data
  FROM   "transactions"
  WHERE  "txData"->'data'->'content'->'type' = '"tx_unbond.wasm"'
  AND (
    "txData"->'data'->'content'->'data'->'source' = :source
    OR
    "txData"->'data'->'content'->'data'->'validator' = :validator
  )
  ORDER BY "blockHeight" DESC LIMIT :limit OFFSET :offset
`, {
  type: QueryTypes.SELECT, replacements: {
    source:    JSON.stringify(source),
    validator: JSON.stringify(validator),
    limit,
    offset
  }
})

export const txWithAddressCount = async ({ address = "" }) => await toCount(db.query(`
  SELECT COUNT(*) FROM "transactions" WHERE (
    (
      "txData"->'data'->'content'->'type' = '"tx_bond.wasm"'
      OR
      "txData"->'data'->'content'->'type' = '"tx_unbond.wasm"'
    ) AND (
      "txData"->'data'->'content'->'data'->'source' = :address
      OR
      "txData"->'data'->'content'->'data'->'validator' = :address
    )
  ) OR (
    (
      "txData"->'data'->'content'->'type' = '"tx_become_validator.wasm"'
      OR
      "txData"->'data'->'content'->'type' = '"tx_deactivate_validator.wasm"'
    )
    AND "txData"->'data'->'content'->'data'->'address' = :address
  ) OR (
    "txData"->'data'->'content'->'type' = '"tx_change_validator_metadata.wasm"'
    AND
    "txData"->'data'->'content'->'data'->'validator' = :address
  )
`, {
  replacements: {
    address: JSON.stringify(address)
  }
}))

export const txWithAddressList = async ({
  address   = "",
  limit     = 100,
  offset    = 0
}) => await db.query(`
  SELECT * FROM "transactions" WHERE (
    (
      "txData"->'data'->'content'->'type' = '"tx_bond.wasm"'
      OR
      "txData"->'data'->'content'->'type' = '"tx_unbond.wasm"'
    ) AND (
      "txData"->'data'->'content'->'data'->'source' = :address
      OR
      "txData"->'data'->'content'->'data'->'validator' = :address
    )
  ) OR (
    (
      "txData"->'data'->'content'->'type' = '"tx_become_validator.wasm"'
      OR
      "txData"->'data'->'content'->'type' = '"tx_deactivate_validator.wasm"'
    )
    AND "txData"->'data'->'content'->'data'->'address' = :address
  ) OR (
      "txData"->'data'->'content'->'type' = '"tx_change_validator_metadata.wasm"'
      AND
      "txData"->'data'->'content'->'data'->'validator' = :address
  )
  ORDER BY "blockHeight" DESC LIMIT :limit OFFSET :offset
`, {
  type: QueryTypes.SELECT, replacements: {
    address: JSON.stringify(address),
    limit,
    offset
  }
})

export const transferredTokens = async () => await db.query(`
  WITH "transactionData" AS (
    SELECT jsonb_path_query("txData", '$.data.content.data[*]') as "txData"
    FROM  "transactions"
    WHERE "txData"->'data'->'content'->'type' = '"tx_transfer.wasm"'
  )
  SELECT
    jsonb_path_query("txData", '$.source[*].token') AS source_token,
    jsonb_path_query("txData", '$.target[*].token') AS target_token
  FROM "transactionData"
`)

export const transferCount = async ({
  address = "",
  source  = address,
  target  = address,
}) => await toCount(db.query(`
  WITH
    "transactionData" AS (
      SELECT
        jsonb_path_query("txData", '$.data.content.data[*]') as "txData"
      FROM "transactions"
      WHERE "txData"->'data'->'content'->'type' = '"tx_transfer.wasm"'
    ),
    "transfers" AS (
      SELECT
        jsonb_path_query("txData", '$.sources[*].owner') AS source,
        jsonb_path_query("txData", '$.targets[*].owner') AS target
      FROM "transactionData"
    )
  SELECT COUNT(*) FROM "transfers"
  WHERE "source" = :source OR "target" = :target
`, {
  type: QueryTypes.COUNT,
  replacements: {
    source: JSON.stringify(source),
    target: JSON.stringify(target),
  }
}))

export const transferList = async ({
  address = "",
  source  = address,
  target  = address,
  limit   = 100,
  offset  = 0
}) => {
  return await db.query(`
    WITH
      "transactionData" AS (
        SELECT
          "blockHeight",
          "txHash",
          "txTime",
          jsonb_path_query("txData", '$.data.content.data[*]') as "txData"
        FROM "transactions"
        WHERE "txData"->'data'->'content'->'type' = '"tx_transfer.wasm"'
      ),
      "transfers" AS (
        SELECT
          "blockHeight",
          "txHash",
          "txTime",
          jsonb_path_query("txData", '$.sources[*].owner') AS source,
          jsonb_path_query("txData", '$.sources[*].token') AS sourceToken,
          jsonb_path_query("txData", '$.sources[*][1]')    AS sourceAmount,
          jsonb_path_query("txData", '$.targets[*].owner') AS target,
          jsonb_path_query("txData", '$.targets[*].token') AS targetToken,
          jsonb_path_query("txData", '$.targets[*][1]')    AS targetAmount
        FROM "transactionData"
      )
    SELECT * FROM "transfers"
    WHERE "source" = :source OR "target" = :target
    ORDER BY "blockHeight" DESC LIMIT :limit OFFSET :offset
  `, {
    type: QueryTypes.SELECT,
    replacements: {
      source: JSON.stringify(source),
      target: JSON.stringify(target),
      limit,
      offset
    }
  })
}

export const validatorByConsensusAddress = consensusAddress =>
  DB.Validator.findOne({
    attributes: [
      'namadaAddress',
      'publicKey',
      'consensusAddress',
      'metadata'
    ],
    where: {
      [Op.or]: [
        { consensusAddress },
        { pastConsensusAddresses: { [Op.contains]: [consensusAddress] } }
      ]
    }
  })

export const validatorsTop = ({ limit = 15 } = {}) =>
  DB.Validator.findAll({
    attributes: defaultAttributes(),
    order: [['stake', 'DESC']],
    limit,
    offset: 0,
  })

export const validatorPublicKeyToConsensusAddresses = async (publicKey) =>
  publicKey
    ? await DB.Validator.findOne({
        attributes: { include: [ 'consensusAddress', 'pastConsensusAddresses' ] },
        where: { publicKey }
      }).then(v=>v.get())
    : {}

export const defaultAttributes = (args = {}) => {
  const attrs = { exclude: ['createdAt', 'updatedAt'] }
  if (args instanceof Array) {
    attrs.include = args
  } else if (args instanceof Object) {
    if (args.include) attrs.include = [...new Set([...attrs.include||[], ...args.include])]
    if (args.exclude) attrs.exclude = [...new Set([...attrs.exclude||[], ...args.exclude])]
  } else {
    throw new Error('defaultAttributes takes Array or Object')
  }
  return attrs
}
