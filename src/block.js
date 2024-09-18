//deno-lint-ignore-file no-async-promise-executor
import { Console } from '@fadroma/namada'
import * as DB from './db.js';
import * as Query from './query.js';
import {
  BLOCK_UPDATE_INTERVAL,
  GOVERNANCE_TRANSACTIONS,
  VALIDATOR_TRANSACTIONS,
  NODE_LOWEST_BLOCK_HEIGHT
} from './config.js'

const console = new Console('Block')

/** Base block indexer.
 *
 * This class knows about fetching and processing block and transaction data
 * from the chain API. However, listening for new blocks is only implemented
 * in the subclasses. */
export class BlockIndexer {
  constructor ({ chain, events }) {
    this.chain  = chain
    this.events = events
  }

  /** Update blocks between startHeight and endHeight */
  async updateBlocks (startHeight, endHeight) {
    console.log("=> Processing blocks from", startHeight, "to", endHeight);
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
      await DB.Block.upsert(data, { transaction: dbTransaction });

      // Update transactions from block:
      for (const transaction of block.transactions) {
        await this.updateTransaction({ height, transaction, dbTransaction })
      }

    }), { update: 'block', height })

    // Log performed updates.
    const t = performance.now() - t0
    const console = new Console(`Block ${height}`)
    for (const {id} of block.transactions) console.log("++ Added transaction", id)
    console.log("++ Added block", height, 'in', t.toFixed(0), 'msec');
    console.br()
  }

  /** Update a single transaction in the database. */
  async updateTransaction ({ height, transaction, dbTransaction, }) {
    const console = new Console(`Block ${height}, TX ${transaction.id.slice(0, 8)}`)
    const { content, sections } = transaction.data
    if (content) {
      console.log("=> Add content", content.type);
      const uploadData = { ...content }
      if (GOVERNANCE_TRANSACTIONS.includes(uploadData.type)) {
        uploadData.data.proposalId = Number(uploadData.data.id);
        delete uploadData.data.id;
      }
      // Emit events based on tx content
      if (VALIDATOR_TRANSACTIONS.includes(content.type)) {
        this.events?.emit("updateValidators", height);
      }
      if (content.type === "transaction_vote_proposal.wasm") {
        this.events?.emit("updateProposal", content.data.proposalId, height);
      }
      if (content.type === "transaction_init_proposal.wasm") {
        this.events?.emit("createProposal", content.data, height);
      }
    } else {
      console.warn(`!! No supported content in tx ${transaction.id}`)
    }
    // Log transaction section types.
    for (const section of sections) {
      console.log("=> Add section", section.type);
    }
    const data = {
      chainId:     transaction.data.chainId,
      blockHash:   transaction.block.hash,
      blockTime:   transaction.block.time,
      blockHeight: transaction.block.height,
      txHash:      transaction.id,
      txTime:      transaction.data.timestamp,
      txData:      transaction,
    }
    console.log("=> Adding transaction", data);
    await DB.Transaction.upsert(data, { transaction: dbTransaction });
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
      console.info("=> No new blocks");
    }
  }
}

/** Connects to a WebSocket that exposes a pausable full node,
 * and listens for sync progressblock notifications. */
export class ControllingBlockIndexer extends BlockIndexer {

  constructor ({ ws, ...rest }) {
    super(rest)
    this.ws = ws
  }

  async run () {

    // Current state of chain
    let latestBlockOnChain, latestEpochOnChain
    const updateLatestOnChain = () => Promise.all([
      this.chain.fetchHeight(),
      this.chain.fetchEpoch(),
    ]).then(([block, epoch])=>{
      if (latestBlockOnChain != BigInt(block)) {
        latestBlockOnChain = BigInt(block)
        console.log('New chain height:', latestBlockOnChain)
      }
      if (latestEpochOnChain != BigInt(epoch)) {
        latestEpochOnChain = BigInt(epoch)
        console.log('New chain epoch: ', latestEpochOnChain)
      }
    })

    // Current state of indexed data
    let latestBlockInDB, latestEpochInDB
    const updateLatestInDB = () => Promise.all([
      Query.latestBlock(),
      Query.latestEpoch(),
    ]).then(([block, epoch])=>{
      if (latestBlockInDB != BigInt(block||0)) {
        latestBlockInDB = BigInt(block||0)
        console.log('New DB height:   ', latestBlockOnChain)
      }
      if (latestEpochInDB != BigInt(epoch||0)) {
        latestEpochInDB = BigInt(epoch||0)
        console.log('New DB epoch:    ', latestEpochOnChain)
      }
    })

    // Establish current state
    await Promise.all([ updateLatestOnChain(), updateLatestInDB() ])

    // Auto-renewing lock. The main loop waits for it when there are no new blocks.
    // When the node has synced more blocks, it emits a notification via websocket.
    // The socket handler below calls gotMoreBlocks to unlock this, allowing the main loop
    // to ingest the new block(s).
    let moreBlocks = new Promise(()=>{/*ignored*/})
    let gotMoreBlocks = () => {/*ignored*/}
    const needMoreBlocks = () => {
      moreBlocks = new Promise(resolve=>{gotMoreBlocks=resolve}).then(needMoreBlocks)
    }
    needMoreBlocks()

    // Continually try to connect to control socket
    const connect = (backoff = 0) => this.socket = new Promise(async resolve => {
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
          this.socket = connect(backoff + 250)
        })

        socket.addEventListener('message', async message => {
          const data = JSON.parse(message.data)
          if (data.synced) {
            let {block, epoch} = data.synced
            block = BigInt(block)
            epoch = BigInt(epoch)
            if (block > latestBlockInDB) {
              await updateLatestOnChain()
              gotMoreBlocks()
            }
          }
        })

      } catch (e) {
        console.error(e)
        console.error('Failed to connect to', this.ws, 'retrying in 1s')
        this.socket = connect(backoff + 250)
      }
    })

    await connect()

    while (true) {

      if (latestBlockInDB < latestBlockOnChain) {
        for (let height = latestBlockInDB + 1n; height <= latestBlockOnChain; height++) {
          console.log('Index block', height)
          while (true) try {
            await this.updateBlock({ height })
            break
          } catch (e) {
            console.error(e)
            console.error('Failed to update block', e, 'waiting 1s and retrying...')
            await new Promise(resolve=>setTimeout(resolve, 1000))
          }
        }
        await updateLatestInDB()
        console.log('Waiting for more blocks')
        ;(await this.socket).send(JSON.stringify({resume:{}}))
        await moreBlocks
      } else {
        await Promise.all([ updateLatestOnChain(), updateLatestInDB() ])
        if (!(await (await fetch('http://localhost:25555/')).json()).services.proxy) {
          ;(await this.socket).send(JSON.stringify({resume:{}}))
        }
      }

    }

  }

}
