//deno-lint-ignore-file no-async-promise-executor
import EventEmitter from "node:events"
import { Console } from '@fadroma/namada'
import * as DB from './db.js'
import * as Query from './query.js'
import { GOVERNANCE_TRANSACTIONS, VALIDATOR_TRANSACTIONS, } from './config.js'

const console = new Console('')
console.debug = () => {}

const pad = x => String(x).padEnd(10)

/** Run up to `max` tasks in parallel. */
export async function pile ({ max, process, inputs }) {
  const pile = new Set()
  while ((inputs.length > 0) || (pile.size > 0)) {
    while ((pile.size < max) && (inputs.length > 0)) {
      const task = process(inputs.shift())
      pile.add(task)
      task.finally(()=>pile.delete(task))
    }
    await Promise.race([...pile])
  }
}

/** Connects to a WebSocket that exposes a pausable full node,
 * and listens for sync progress notifications. */
export class ControllingBlockIndexer {

  constructor ({ log = console, ws, chain, events }) {
    this.log = console
    this.log.debug = () => {}

    this.chain = chain
    this.chain.log.debug = () => {}
    this.chain.connections[0].log.debug = () => {}

    this.ws = ws
    this.events = events || new EventEmitter()
    this.updater = new Updater({
      log:    this.log,
      chain:  this.chain,
      events: this.events
    })

    // Auto-renewing lock. The main loop waits for it when there are no new blocks.
    // When the node has synced more blocks, it emits a notification via websocket.
    // The socket handler below calls gotMoreBlocks to unlock this, allowing the main loop
    // to ingest the new block(s).
    const needMoreBlocks = () => {
      this.moreBlocks = new Promise(resolve=>{
        this.gotMoreBlocks = resolve
      }).then(needMoreBlocks)
    }
    needMoreBlocks()
  }

  latestBlockOnChain = BigInt(0)
  latestBlockInDB    = BigInt(0)
  moreBlocks         = new Promise(()=>{/*ignored*/})
  gotMoreBlocks      = () => {/*ignored*/}
  needMoreBlocks // set by constructor

  latestEpochOnChain = BigInt(0)
  latestEpochInDB    = BigInt(0)
  epochChanged       = false

  async run () {
    // Continually try to connect to control socket
    await this.connect()
    // Fetch data
    while (true) await this.updateOnce()
  }

  async updateOnce () {
    const t0 = performance.now()
    await this.updateCounters()
    await Promise.all([this.updatePerEpoch(), this.updatePerBlock()])
    await this.updateCounters()
    if (await this.isPaused()) await this.resume()
    console.log('Last iteration:', ((performance.now() - t0)/1000).toFixed(3), 's')
  }

  async updatePerEpoch () {
    await this.updateCounters()
    if (this.epochChanged) {
      const epoch = await this.chain.fetchEpoch()
      await Promise.all([
        this.updater.updateTotalStake(epoch),
        this.updater.updateValidators(epoch),
      ])
      this.epochChanged = false
    }
  }

  async updatePerBlock () {
    while (true) {
      await this.updateCounters()
      if (this.latestBlockInDB >= this.latestBlockOnChain) break
      while (true) try {
        await this.updater.updateBlock({ height: this.latestBlockInDB + 1n })
        break
      } catch (e) {
        console.error(e)
        console.error('Failed to update block', e, 'waiting 1s and retrying...')
        await new Promise(resolve=>setTimeout(resolve, 1000))
      }
    }
  }

  async updateCounters () {
    // Reset sync if chain is more than 2 epochs ahead of database.
    // This is because some data is only stored for 2 epochs' time, then pruned.
    if (this.latestEpochInDB < this.latestEpochOnChain - 2n) {
      this.log.warn(`🚨🚨🚨 DB is >2 epochs behind chain (DB ${this.latestEpochInDB}, chain ${this.latestEpochOnChain}). Resyncing node from block 1!`)
      await this.restart()
    }
    // Fetch up-to-date values of counters
    await Promise.all([this.updateCountersChain(), this.updateCountersDB()])
  }

  // Current state of chain
  async updateCountersChain () {
    return await Promise.all([this.updateChainBlock(), this.updateChainEpoch()])
  }
  // Current state of indexed data
  async updateCountersDB () {
    return await Promise.all([this.updateDBBlock(), this.updateDBEpoch()])
  }

  async updateCountersBlock () {
    return await Promise.all([this.updateDBBlock(), this.updateChainBlock()])
  }

  async updateChainBlock () {
    const block = BigInt(await this.chain.fetchHeight())
    if (this.latestBlockOnChain != block) {
      const onChain = this.latestBlockOnChain = block
      const inDB    = this.latestBlockInDB
      console.log(`Block on chain:  ${pad(onChain)} (${pad(onChain - inDB)} behind)`)
    }
  }

  async updateCountersEpoch () {
    return await Promise.all([this.updateDBEpoch(), this.updateChainEpoch()])
    if (this.latestEpochInDB < this.latestEpochOnChain - 2n) {
      this.log.warn(`🚨🚨🚨 DB is >2 epochs behind chain (DB ${this.latestEpochInDB}, chain ${this.latestEpochOnChain}). Resyncing node from block 1!`)
      await this.restart()
    }
  }

  async updateChainEpoch () {
    const epoch = BigInt(await this.chain.fetchEpoch())
    if (this.latestEpochOnChain != epoch) {
      this.epochChanged = true
      const onChain = this.latestEpochOnChain = epoch
      const inDB    = this.latestEpochInDB
      console.log(`Epoch on chain:  ${pad(onChain)} (${pad(onChain - inDB)} behind)`)
    }
  }

  async updateDBBlock () {
    const block = BigInt(await Query.latestBlock()||0)
    if (this.latestBlockInDB != block) {
      const inDB    = this.latestBlockInDB = block
      const onChain = this.latestBlockOnChain
      console.debug(`Block in DB:   ${pad(inDB)}    (${pad(onChain - inDB)} behind)`)
    }
  }

  async updateDBEpoch () {
    const epoch = BigInt(await Query.latestEpoch()||0)
    if (this.latestEpochInDB != epoch) {
      const inDB    = this.latestEpochInDB = epoch
      const onChain = this.latestEpochOnChain
      console.debug(`Epoch in DB:   ${pad(inDB)}    (${pad(onChain - inDB)} behind)`)
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

}

/** This class knows about fetching and processing block and transaction data
  * from the chain API. However, listening for new blocks is only implemented
  * in the subclasses. */
export class Updater {

  constructor ({ log, chain, events }) {
    this.log    = log
    this.chain  = chain
    this.events = events
  }

  /** Update blocks between startHeight and endHeight */
  async blocks (startHeight, endHeight) {
    console.log(`Updating blocks ${startHeight}-${endHeight}`)
    let height = startHeight
    try { for (; height <= endHeight; height++) await this.updateBlock({ height }) } catch (e) {
      console.error('Failed to index block', height)
      console.error(e)
    }
  }

  /** Update a single block in the database. */
  async updateBlock ({ height, block }) {
    const t0 = performance.now()
    // If no block was passed, fetch it.
    if (!block) while (true) try {
      block = await this.chain.fetchBlock({ height, raw: true })
      break
    } catch (e) {
      this.log.error(e)
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
          this.log.warn('Could not fetch epoch for block', height, '- will retry later')
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
    for (const {id} of block.transactions) this.log.log("Block", height, "TX", id)
    this.log.log("Added block", height, 'in', t.toFixed(0), 'msec')
    //this.log.br()
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

  async updateValidators (epoch) {
    const t0 = performance.now()
    this.log("Updating validators at epoch", epoch)
    let validators = 0
    const [currentConsensusValidators, previousConsensusValidators] = await Promise.all([
      this.chain.fetchValidatorsConsensus(epoch),
      (epoch > 0n) ? await this.chain.fetchValidatorsConsensus(epoch - 1n) : Promise.resolve([])
    ])
    const addressOnly = x => x.map(y=>y.address)
    const consensusValidators = new Set([
      ...addressOnly(currentConsensusValidators),
      ...addressOnly(previousConsensusValidators),
    ])
    await pile({
      max:     30,
      inputs:  [...consensusValidators],
      process: address => this.updateValidator(address, epoch).then(()=>validators++)
    })
    console.log(
      'Epoch', pad(epoch), `updated`, validators,
      `consensus validators in`, ((performance.now()-t0)/1000).toFixed(3), 's'
    )
    const otherValidators = await this.chain.fetchValidatorAddresses(epoch)
    await pile({
      max:     30,
      inputs:  otherValidators.filter(x=>!consensusValidators.has(x)),
      process: address => this.updateValidator(address, epoch).then(()=>validators++)
    })
    console.log(
      'Epoch', pad(epoch), `updated`, validators,
      `validators total in`, ((performance.now()-t0)/1000).toFixed(3), 's'
    )
  }

  async updateValidator (address, epoch) {
    const validator = await this.chain.fetchValidator(address, { epoch })
    this.log(
      "Adding validator", validator.namadaAddress,
      'at epoch', epoch,
      'with state', validator.state.epoch, '/', validator.state.state
    )
    await DB.Validator.upsert(Object.assign(validator, { epoch }))
    return { added: true }
  }

  async updateTotalStake (epoch) {
    this.log("Updating total stake at epoch", epoch)
    const total = await this.chain.fetchTotalStaked({ epoch })
    console.log('Epoch', pad(epoch), 'total stake:', total)
  }

  async updateBondedStake (validator, delegator, epoch) {
  }

  async updateProposal (id, epoch) {
  }

}
