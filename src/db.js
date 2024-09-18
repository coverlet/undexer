import { Console } from "@hackbg/logs"
import { Sequelize, DataTypes, Op } from "sequelize"
import PG from "pg"
import { CHAIN_ID, DATABASE_URL } from "./config.js"

export { Sequelize, DataTypes, Op }

const console = new Console("DB");

const { DATE, TEXT, BLOB, JSONB, INTEGER, ENUM } = DataTypes

const db = new Sequelize(DATABASE_URL, {
  dialect: "postgres",
  logging: () => console.log,
  logQueryParameters: true,
  supportBigNumbers: true,
})

let dbName
try {
  const { username, password, hostname, port, pathname } = new URL(DATABASE_URL)
  dbName = pathname.slice(1) || CHAIN_ID
  console.br().log(`Creating database "${dbName}"...`)
  const pg = new PG.Client({ user: username, password, host: hostname, port })
  await pg.connect()
  await pg.query(`CREATE DATABASE "${dbName}"`)
} catch (e) {
  if (e.code === '42P04') {
    console.info(`Database "${dbName}" exists.`)
  } else {
    if (e.code === 'ECONNREFUSED') {
      console.error(`Connection refused. Make sure Postgres is running at ${e.address}:${e.port}`)
    } else {
      console.error(e)
    }
    console.error(`Failed to create database "${dbName}". See above for details.`)
    process.exit(1)
  }
}

// Allow sorting strings as numbers.
// See https://github.com/sequelize/sequelize/discussions/15529#discussioncomment-4601186
try {
  await db.query(`CREATE COLLATION IF NOT EXISTS numeric (provider = icu, locale = 'en-u-kn-true')`)
} catch (e) {
  console.error(e)
  console.warn('FIXME: CREATE COLLATION threw. This is normal only after first run.')
}

export default db

export const IntegerPrimaryKey = (autoIncrement = false) => ({
  type:       INTEGER,
  allowNull:  false,
  unique:     true,
  primaryKey: true,
  autoIncrement
})

export const StringPrimaryKey = () => ({
  type:       TEXT,
  allowNull:  false,
  unique:     true,
  primaryKey: true,
})

import { serialize } from './utils.js'

export const JSONField = name => ({
  type: JSONB,
  allowNull: false,
  set (value) {
    return this.setDataValue(name, JSON.parse(serialize(value)));
  },
})

export const NullableJSONField = name => ({
  type: JSONB,
  allowNull: true,
  set (value) {
    if (value === undefined) {
      this.setDataValue(name, null);
    }
    else {
      this.setDataValue(name, JSON.parse(serialize(value)));
    }
  },
})

export const VALIDATOR_STATES = [
  "BelowThreshold",
  "BelowCapacity",
  "Jailed",
  "Consensus",
  "Inactive"
]

const blockMeta = () => ({
  chainId:      { type: TEXT,    allowNull: false },
  blockHash:    { type: TEXT,    allowNull: false },
  blockHeight:  { type: INTEGER, allowNull: false },
  blockTime:    { type: DATE },
})

export const PROPOSAL_STATUS = [
  "ongoing",
  "finished",
  "upcoming",
]

export const PROPOSAL_RESULT = [
  "passed",
  "rejected",
]

export const PROPOSAL_TALLY_TYPE = [
  "OneHalfOverOneThird",
  "TwoThirds",
  "LessOneHalfOverOneThirdNay"
]

export const

  ErrorLog = db.define('error_log', {
    id:        IntegerPrimaryKey(true),
    timestamp: { type: DATE },
    message:   { type: TEXT },
    stack:     JSONField('stack'),
    info:      NullableJSONField('info'),
  }),

  Epoch = db.define('epoch', {
    id:         IntegerPrimaryKey(true),
    totalStake: { type: INTEGER },
    parameters: JSONField('parameters')
  }),

  Validator = db.define('validator', {
    epoch:                  { type: INTEGER },
    namadaAddress:          StringPrimaryKey(),
    publicKey:              { type: TEXT, allowNull: true },
    pastPublicKeys:         NullableJSONField('pastPublicKeys'),
    consensusAddress:       { type: TEXT, allowNull: true },
    pastConsensusAddresses: NullableJSONField('pastConsensusAddresses'),
    votingPower:            { type: TEXT, allowNull: true },
    proposerPriority:       { type: TEXT, allowNull: true },
    metadata:               NullableJSONField('metadata'),
    commission:             NullableJSONField('commission'),
    stake:                  { type: TEXT, allowNull: true },
    state:                  NullableJSONField('state')
  }),

  Block = db.define('block', {
    ...blockMeta(),
    epoch:        { type: INTEGER },
    blockHash:    StringPrimaryKey(),
    blockHeader:  JSONField('blockHeader'),
    rpcResponses: JSONField('rpcResponses'),
    blockData:    NullableJSONField('blockData'),
    blockResults: NullableJSONField('blockResults'),
  }),

  Transaction = db.define('transaction', {
    ...blockMeta(),
    txHash: StringPrimaryKey(),
    txTime: { type: DATE },
    txData: JSONField('txData'),
  }),

  Proposal = db.define('proposal', {
    id:       IntegerPrimaryKey(),
    content:  JSONField('content'),
    metadata: JSONField('metadata'),
    result:   NullableJSONField('result'),
  }),

  ProposalWASM = db.define('proposal_wasm', {
    id:       IntegerPrimaryKey(),
    codeKey:  { type: TEXT },
    wasm:     { type: BLOB },
  }),

  Vote = db.define("vote", {
    id:       IntegerPrimaryKey(true),
    proposal: { type: INTEGER },
    data:     JSONField('data'),
  });

export function logErrorToDB (error, info) {
  return ErrorLog.create({
    timestamp: new Date(),
    message:   error?.message,
    stack:     error?.stack,
    info
  })
}

export async function withErrorLog (callback, info) {
  try {
    return Promise.resolve(callback())
  } catch (error) {
    console.error('Logging error to database:', error)
    await logErrorToDB(error, info)
    throw error
  }
}
