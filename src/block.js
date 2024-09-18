//deno-lint-ignore-file no-async-promise-executor
import { Console } from '@fadroma/namada'
import * as DB from './db.js'
import * as Query from './query.js'
import {
  BLOCK_UPDATE_INTERVAL,
  GOVERNANCE_TRANSACTIONS,
  VALIDATOR_TRANSACTIONS,
  NODE_LOWEST_BLOCK_HEIGHT
} from './config.js'
import EventEmitter from "node:events"

const console = new Console('')
console.debug = () => {}

/** Base block indexer.
 *
 * This class knows about fetching and processing block and transaction data
 * from the chain API. However, listening for new blocks is only implemented
 * in the subclasses. */
export class BlockIndexer {

  constructor ({ chain, events }) {
    this.log = console
    this.log.debug = () => {}
    this.chain = chain
    this.chain.log.debug = () => {}
    this.chain.connections[0].log.debug = () => {}
    this.events = events || new EventEmitter()
  }

  /** Update blocks between startHeight and endHeight */
  async updateBlocks (startHeight, endHeight) {
    console.log("=> Processing blocks from", startHeight, "to", endHeight)
    let height = startHeight
    try { for (; height <= endHeight; height++) await this.updateBlock({ height }) } catch (e) {
      console.error('Failed to index block', height)
      console.error(e)
    }
  }

  /** Update a single block in the database. */
  async updateBlock ({ height, block }) {
    const t0 = performance.now()
    let console = this.log
    // If no block was passed, fetch it.
    if (!block) while (true) try {
      block = await this.chain.fetchBlock({ height, raw: true })
      break
    } catch (e) {
      console.error(e)
      await new Promise(resolve=>setTimeout(resolve, 1000))
    }
    // Make sure there isn't a mismatch between required and actual height
    height = block.height
    await DB.withErrorLog(() => DB.default.transaction(async dbTransaction => {
      const data = {
        chainId:      block.header.chainId,
        blockTime:    block.time,
        blockHeight:  block.height,
        blockHash:    block.hash,
        blockHeader:  block.header,
        blockData:    JSON.parse(block.responses?.block.response||"null"),
        blockResults: JSON.parse(block.responses?.results?.response||"null"),
        rpcResponses: block.responses,
        epoch:        await this.chain.fetchEpoch({ height }).catch(()=>{
          console.warn('Could not fetch epoch for block', height, '- will retry later')
          return undefined
        }),
      }
      await DB.Block.upsert(data, { transaction: dbTransaction })
      // Update transactions from block:
      for (const transaction of block.transactions) {
        await this.updateTransaction({ height, transaction, dbTransaction })
      }
    }), { update: 'block', height })
    // Log performed updates.
    const t = performance.now() - t0
    for (const {id} of block.transactions) console.log("Block", height, "TX", id)
    console.log("Added block", height, 'in', t.toFixed(0), 'msec')
    //console.br()
  }

  /** Update a single transaction in the database. */
  async updateTransaction ({ height, transaction, dbTransaction, }) {
    const console = new Console(`Block ${height}, TX ${transaction.id.slice(0, 8)}`)
    const { content, /*sections*/ } = transaction.data
    if (content) {
      console.log("TX content:", content.type)
      const uploadData = { ...content }
      if (GOVERNANCE_TRANSACTIONS.includes(uploadData.type)) {
        uploadData.data.proposalId = Number(uploadData.data.id)
        delete uploadData.data.id
      }
      // Emit events based on tx content
      if (VALIDATOR_TRANSACTIONS.includes(content.type)) {
        this.events?.emit("updateValidators", height)
      }
      if (content.type === "transaction_vote_proposal.wasm") {
        this.events?.emit("updateProposal", content.data.proposalId, height)
      }
      if (content.type === "transaction_init_proposal.wasm") {
        this.events?.emit("createProposal", content.data, height)
      }
    } else {
      console.warn("No supported TX content in", transaction.id)
    }
    // Log transaction section types.
    //for (const section of sections) {
      //console.debug("=> Add section", section.type)
    //}
    const data = {
      chainId:     transaction.data.chainId,
      blockHash:   transaction.block.hash,
      blockTime:   transaction.block.time,
      blockHeight: transaction.block.height,
      txHash:      transaction.id,
      txTime:      transaction.data.timestamp,
      txData:      transaction,
    }
    //console.debug("=> Adding transaction", data)
    await DB.Transaction.upsert(data, { transaction: dbTransaction })
    console.log("=> Added transaction", data.txHash)
  }

  async updateTotalStake (epoch) {
    const total = await this.chain.fetchTotalStaked({ epoch })
    console.log('Epoch', pad(epoch), 'total stake:', total)
  }

  async updateValidators (epoch) {
    let validators = 0
    const [currentConsensusValidators, previousConsensusValidators] = await Promise.all([
      this.chain.fetchValidatorsConsensus(epoch),
      (epoch > 0n) ? await this.chain.fetchValidatorsConsensus(epoch) : Promise.resolve([])
    ])
    const addressOnly = x => x.map(y=>y.address)
    const consensusValidators = set(
      addressOnly(currentConsensusValidators),
      addressOnly(previousConsensusValidators),
    )
    for (const address of [...consensusValidators]) {
      await this.updateValidator(await this.chain.fetchValidator(address), epoch)
      validators++
    }
    console.log('Epoch', pad(epoch), `updated`, validators, `consensus validators`)
    const otherValidators = await this.chain.fetchValidatorAddresses(epoch)
    for (const address of otherValidators) {
      if (!consensusValidators.has(address)) {
        await this.updateValidator(await this.chain.fetchValidator(address), epoch)
        validators++
      }
    }
    console.log('Epoch', pad(epoch), `updated`, validators, `validators total`)
  }

  async updateValidator (validator, epoch) {
    console.log("Adding validator", validator.namadaAddress)
    await DB.Validator.upsert(Object.assign(validator, { epoch }))
    return { added: true }
  }

}

/** Polls the chain for new blocks on a given interval. */
export class PollingBlockIndexer extends BlockIndexer {
  run () {
    return runForever(BLOCK_UPDATE_INTERVAL, this.tryUpdateBlocks.bind(this))
  }
  /** Called every `BLOCK_UPDATE_INTERVAL` msec by a `setInterval` in `bin/indexer.js` */
  async tryUpdateBlocks () {
    // Setting `NODE_LOWEST_BLOCK_HEIGHT` allows a minimum block to be set
    const latestBlockInDb = await Query.latestBlock() || Number(NODE_LOWEST_BLOCK_HEIGHT)
    console.log("=> Latest block in DB:", latestBlockInDb)
    const latestBlockOnChain = await chain.fetchHeight()
    console.log("=> Latest block on chain:", latestBlockOnChain)
    if (latestBlockOnChain > latestBlockInDb) {
      await this.updateBlocks(latestBlockInDb + 1, latestBlockOnChain)
    } else {
      console.info("=> No new blocks")
    }
  }
}

/** Connects to a WebSocket that exposes a pausable full node,
 * and listens for sync progressblock notifications. */
export class ControllingBlockIndexer extends BlockIndexer {

  constructor ({ ws, ...rest }) {
    super(rest)
    this.ws = ws

    this.latestBlockOnChain = BigInt(0)
    this.latestEpochOnChain = BigInt(0)
    this.latestBlockInDB    = BigInt(0)
    this.latestEpochInDB    = BigInt(0)
    this.epochChanged       = false

    // Auto-renewing lock. The main loop waits for it when there are no new blocks.
    // When the node has synced more blocks, it emits a notification via websocket.
    // The socket handler below calls gotMoreBlocks to unlock this, allowing the main loop
    // to ingest the new block(s).
    this.moreBlocks = new Promise(()=>{/*ignored*/})
    this.gotMoreBlocks = () => {/*ignored*/}
    const needMoreBlocks = () => {
      this.moreBlocks = new Promise(resolve=>{
        this.gotMoreBlocks = resolve
      }).then(needMoreBlocks)
    }
    needMoreBlocks()
  }

  async run () {
    // Continually try to connect to control socket
    await this.connect()
    // Establish current state. (May restart node sync if out of data.)
    await this.updateCounters()
    // Fetch data
    while (true) await Promise.all([
      this.updatePerEpoch(),
      this.updatePerBlock(),
    ]).then(async ()=>{
      await this.updateCounters()
      if (await this.isPaused()) await this.resume()
    })
  }

  connect (backoff = 0) {
    return this.socket = new Promise(async resolve => {
      if (backoff > 0) {
        console.log('Waiting for', backoff, 'msec before connecting to socket...')
        await new Promise(resolve=>setTimeout(resolve, backoff))
      }
      try {
        console.log('Connecting to', this.ws)
        const socket = new WebSocket(this.ws)

        socket.addEventListener('open', () => {
          console.log('Connected to', this.ws)
          backoff = 0
          resolve(socket)
        })

        socket.addEventListener('close', () => {
          console.log('Disconnected from', this.ws, 'reconnecting...')
          this.socket = this.connect(backoff + 250)
        })

        socket.addEventListener('message', message => {
          const data = JSON.parse(message.data)
          if (data.synced) {
            const {block, epoch} = data.synced
            this.latestBlockOnChain = BigInt(block)
            this.latestEpochOnChain = BigInt(epoch)
            if (this.latestBlockOnChain > this.latestBlockInDB) {
              this.gotMoreBlocks()
            }
          }
        })

      } catch (e) {
        console.error(e)
        console.error('Failed to connect to', this.ws, 'retrying in 1s')
        this.socket = this.connect(backoff + 250)
      }
    })
  }

  async updatePerEpoch () {
    if (this.epochChanged) {
      const epoch = this.latestEpochOnChain
      await this.updateTotalStake(epoch)
      await this.updateValidators(epoch)
      this.epochChanged = false
    }
  }

  async updatePerBlock () {
    while (true) {
      await this.updateCounters()
      if (this.latestBlockInDB >= this.latestBlockOnChain) break
      while (true) try {
        await this.updateBlock({ height: this.latestBlockInDB + 1n })
        break
      } catch (e) {
        console.error(e)
        console.error('Failed to update block', e, 'waiting 1s and retrying...')
        await new Promise(resolve=>setTimeout(resolve, 1000))
      }
    }
  }

  async isPaused () {
    const status = await (await fetch('http://localhost:25555/')).json()
    return !status.services.proxy
  }

  async resume () {
    const socket = await this.socket
    console.log('Resume sync')
    socket.send(JSON.stringify({resume:{}}))
  }

  async restart () {
    const socket = await this.socket
    console.log('Restart sync')
    socket.send(JSON.stringify({restart:{}, resume:{}}))
  }

  async updateCounters () {
    // Reset sync if chain is more than 2 epochs ahead of database.
    // This is because some data is only stored for 2 epochs' time, then pruned.
    if (this.latestEpochInDB < this.latestEpochOnChain - 2n) {
      this.log.warn(`🚨🚨🚨 DB is >2 epochs behind chain (DB ${this.latestEpochInDB}, chain ${this.latestEpochOnChain}). Resyncing node from block 1!`)
      await this.restart()
    }
    // Fetch up-to-date values of counters
    await Promise.all([
      this.updateCountersChain(),
      this.updateCountersDB()
    ])
  }

  // Current state of chain
  async updateCountersChain () {
    return await Promise.all([
      this.chain.fetchHeight(),
      this.chain.fetchEpoch(),
    ]).then(([block, epoch])=>{
      if (this.latestEpochOnChain != BigInt(epoch)) {
        this.epochChanged = true
        this.latestEpochOnChain = BigInt(epoch)
        console.log(
          `Fetched chain epoch:  `,
          `${pad(this.latestEpochOnChain)}`,
          `(${pad(this.latestEpochOnChain - this.latestEpochInDB)} behind)`
        )
      }
      if (this.latestBlockOnChain != BigInt(block)) {
        this.latestBlockOnChain = BigInt(block)
        console.log(
          `Fetched chain height: `,
          `${pad(this.latestBlockOnChain)}`,
          `(${pad(this.latestBlockOnChain - this.latestBlockInDB)} behind)`
        )
      }
    })
  }

  // Current state of indexed data
  async updateCountersDB () {
    return await Promise.all([
      Query.latestBlock(),
      Query.latestEpoch(),
    ]).then(([block, epoch])=>{
      if (this.latestEpochInDB != BigInt(epoch||0)) {
        this.latestEpochInDB = BigInt(epoch||0)
        console.debug(
          `Queried DB epoch:     `,
          `${pad(this.latestEpochOnChain)}`,
          `(${pad(this.latestEpochOnChain - this.latestEpochInDB)} behind)`
        )
      }
      if (this.latestBlockInDB != BigInt(block||0)) {
        this.latestBlockInDB = BigInt(block||0)
        console.debug(
          `Queried DB height:    `,
          `${pad(this.latestBlockOnChain)}`,
          `(${pad(this.latestEpochOnChain - this.latestEpochInDB)} behind)`
        )
      }
    })
  }

}

const pad = x => String(x).padEnd(10)

const set = (a, b) => new Set([...a||[], ...b||[]])

const distinct = x => [...new Set(x)]

const stringifier = (_, v) => (typeof v === 'bigint') ? String(v) : v

const appendNonNull = (x, y) => distinct(set(x, [y])).filter(Boolean)
