//deno-lint-ignore-file no-async-promise-executor
import EventEmitter from "node:events"
import { Console } from '@fadroma/namada'
import * as DB from './db.js'
import * as Query from './query.js'
import { START_BLOCK, ALLOW_INCOMPLETE } from './config.js'
import { pad, runParallel, runForever, retryForever, waitForever, maxBigInt } from './utils.js'

const console = new Console('')
console.debug = () => {}

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
  }

  latestBlockOnChain = BigInt(0)
  latestBlockInDB    = BigInt(0 || START_BLOCK)
  latestEpochOnChain = BigInt(0)
  latestEpochInDB    = BigInt(0)
  epochChanged       = false

  async run () {
    await this.connect()
    this.log('Connected. Starting from block', this.latestBlockInDB)
    runForever(1000, this.updatePerBlock.bind(this))
    runForever(1000, this.updatePerEpoch.bind(this))
  }

  async updatePerBlock () {
    await this.updateBlockCounter()
    while (this.latestBlockInDB < this.latestBlockOnChain) {
      const height = this.latestBlockInDB + 1n
      await retryForever(1000, this.updater.updateBlock.bind(this.updater, { height }))
      await this.updateBlockCounter()
    }
  }

  async updateBlockCounter () {
    const [inDB, onChain] = await Promise.all([
      retryForever(1000, async () => {
        return this.latestBlockInDB = maxBigInt(START_BLOCK, BigInt(await Query.latestBlock()||0))
      }),
      retryForever(1000, async () => {
        return this.latestBlockOnChain = await this.chain.fetchHeight()
      }),
    ])
    console.log(`Block ${inDB} of ${onChain} (${(onChain - inDB)} behind)`)
  }

  async updatePerEpoch () {
    await this.updateEpochCounter()
    if (this.epochChanged) {
      const epoch = await this.chain.fetchEpoch()
      await Promise.all([
        retryForever(1000, this.updater.updateTotalStake.bind(this.updater, epoch)),
        retryForever(1000, this.updater.updateValidators.bind(this.updater, epoch)),
        //retryForever(1000, this.updater.updateGovernance.bind(this.updater, epoch)),
      ])
      this.epochChanged = false
    }
    if (await this.isPaused()) {
      await this.resume()
    }
  }

  async updateEpochCounter () {
    const [onChain, inDB] = await Promise.all([
      retryForever(1000, async () => {
        return this.latestEpochOnChain = BigInt(await this.chain.fetchEpoch())
      }),
      retryForever(1000, async () => {
        return this.latestEpochInDB    = BigInt(await Query.latestEpoch()||0)
      }),
    ])
    if (onChain != inDB) {
      this.epochChanged = true
      console.br().log(`Epoch ${inDB} of ${onChain}`)
    }
    if (inDB < onChain - 2n) {
      if (ALLOW_INCOMPLETE) {
        this.log.warn(
          `DB is >2 epochs behind chain (DB ${this.latestEpochInDB}, `+
          `chain ${this.latestEpochOnChain}). Historical data may be inaccurate! `+
          `Run with ALLOW_INCOMPLETE=0 to force resync.`
        )
      } else {
        this.log.warn(
          `🚨🚨🚨 DB is >2 epochs behind chain (DB ${this.latestEpochInDB}, `+
          `chain ${this.latestEpochOnChain}). Resyncing node from block 1!`
        )
        await this.restart()
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
            //console.log('Chain sync progress:', JSON.stringify(data.synced))
            //const {block, epoch} = data.synced
            //this.latestBlockOnChain = BigInt(block)
            //this.latestEpochOnChain = BigInt(epoch)
            //if (this.latestBlockOnChain > this.latestBlockInDB) {
              //this.gotMoreBlocks()
            //}
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
    const [epoch, blockResults] = await Promise.all([
      retryForever(1000, this.chain.fetchEpoch.bind(this.chain, { height })),
      retryForever(1000, this.chain.fetchBlockResults.bind(this.chain, { height })),
    ])
    this.log.br().log(`Block ${height} (epoch ${epoch})`)
    const votedProposals = new Set()
    await DB.withErrorLog(() => DB.default.transaction(async dbTransaction => {
      // Update block record
      await DB.Block.upsert({
        chainId:      block.header.chainId,
        blockTime:    block.time,
        blockHeight:  block.height,
        blockHash:    block.hash,
        blockHeader:  block.header,
        blockData:    JSON.parse(block.responses?.block.response||"null"),
        blockResults: JSON.parse(block.responses?.results?.response||"null"),
        rpcResponses: block.responses,
        epoch,
      }, { transaction: dbTransaction })
      // Update transaction records from block
      for (const transaction of block.transactions) await this.updateTransaction({
        epoch, height, blockResults, transaction, votedProposals, dbTransaction
      })
    }), { update: 'block', height })
    for (const id of [...votedProposals]) {
      await this.updateProposalVotes(id, epoch)
    }
    // Log performed updates.
    const t = performance.now() - t0
    this.log(`Block ${height} (epoch ${epoch}): added in`, t.toFixed(0), 'msec')
  }

  /** Update a single transaction in the database. */
  async updateTransaction ({
    epoch,
    height,
    blockResults,
    votedProposals = new Set(),
    transaction,
    dbTransaction,
  }) {
    this.log(
      `Block ${height} (epoch ${epoch})`,
      `TX ${transaction.data.content?.type}`, transaction.id
    )
    const { type: txType, data: txData } = transaction.data?.content || {}
    if (txType) switch (txType) {
      case "tx_activate_validator.wasm":
      case "tx_add_validator.wasm":
      case "tx_become_validator.wasm":
      case "tx_bond.wasm":
      case "tx_change_validator_commission.wasm":
      case "tx_change_validator_metadata.wasm":
      case "tx_change_validator_power.wasm":
      case "tx_deactivate_validator.wasm":
      case "tx_reactivate_validator.wasm":
      case "tx_remove_validator.wasm":
      case "tx_unbond.wasm":
      case "tx_unjail_validator.wasm": {
        console.log(`Block ${height} (epoch ${epoch}): Updating validator`, txData.validator)
        this.updateValidator(txData.validator, epoch)
        break
      }
      case "tx_init_proposal.wasm": {
        const { content, ...metadata } = txData || {}
        const id = findProposalId(blockResults.endBlockEvents, transaction.id)
        if (id) {
          console.log(`Block ${height} (epoch ${epoch}): New proposal`, id)
          await DB.Proposal.upsert({
            id,
            content,
            metadata,
            initTx: transaction.id
          }, {transaction: dbTransaction})
        } else {
          console.log(`Block ${height} (epoch ${epoch}): New proposal, unknown id, updating all`)
          await this.updateGovernance()
        }
        break
      }
      case "tx_vote_proposal.wasm": {
        console.log(`Block ${height} (epoch ${epoch}) Vote on`, txData.id, 'by', txData.voter)
        votedProposals.add(txData.id)
        await DB.Vote.upsert({
          proposal: txData.id,
          voter:    txData.voter,
          vote:     txData.vote,
          voteTx:   transaction.id,
        }, {transaction: dbTransaction})
        break
      }
    } else {
      console.warn("No supported TX content in", transaction.id)
    }
    await DB.Transaction.upsert({
      chainId:     transaction.data.chainId,
      blockHash:   transaction.block.hash,
      blockTime:   transaction.block.time,
      blockHeight: transaction.block.height,
      txHash:      transaction.id,
      txTime:      transaction.data.timestamp,
      txType:      txType,
      txContent:   txData,
      txData:      transaction, // TODO deprecate
    }, { transaction: dbTransaction })
  }

  async updateValidators (epoch) {
    const t0 = performance.now()
    this.log("Updating validators at epoch", epoch)
    let validatorCount = 0
    const [currentConsensusValidators, previousConsensusValidators] = await Promise.all([
      this.chain.fetchValidatorsConsensus(epoch),
      (epoch > 0n) ? await this.chain.fetchValidatorsConsensus(epoch - 1n) : Promise.resolve([])
    ])
    const addressOnly = x => x.map(y=>y.address)
    const consensusValidators = new Set([
      ...addressOnly(currentConsensusValidators),
      ...addressOnly(previousConsensusValidators),
    ])
    await runParallel({
      max:     50,
      inputs:  [...consensusValidators],
      process: address => this.updateValidator(address, epoch).then(()=>validatorCount++)
    })
    console.log(
      'Epoch', pad(epoch), `updated`, validatorCount,
      `consensus validators in`, ((performance.now()-t0)/1000).toFixed(3), 's'
    )
    const validators = await this.chain.fetchValidatorAddresses(epoch)
    const otherValidators = validators.filter(x=>!consensusValidators.has(x))
    await runParallel({
      max:     50,
      inputs:  otherValidators,
      process: address => this.updateValidator(address, epoch).then(()=>validatorCount++)
    })
    console.log(
      'Epoch', pad(epoch), `updated`, validatorCount,
      `validators total in`, ((performance.now()-t0)/1000).toFixed(3), 's'
    )
  }

  async updateValidator (address, epoch) {
    const validator = await this.chain.fetchValidator(address, { epoch })
    //this.log(
      //"Epoch", epoch,
      //"add validator", validator.namadaAddress,
      //"with state", validator.state.state
    //)
    await DB.Validator.upsert(Object.assign(validator, { epoch }))
    return { added: true }
  }

  async updateTotalStake (epoch) {
    this.log("Updating total stake at epoch", epoch)
    const total = await this.chain.fetchTotalStaked({ epoch })
    console.log('Epoch', pad(epoch), 'total stake:', total)
  }

  async updateBondedStake (validator, delegator, epoch) {
    throw new Error('TODO: update bonded stake')
  }

  async updateGovernance (epoch) {
    const proposals = await this.chain.fetchProposalCount(epoch)
    console.log('Epoch', epoch, 'updating', proposals, 'proposals, starting from latest')
    const inputs = Array(Number(proposals)).fill(-1).map((_,i)=>i).reverse()
    //await runParallel({ max: 30, inputs, process: id => this.updateProposal(id, epoch) })
    for (const id of inputs) {
      await this.updateProposal(id, epoch)
    }
  }

  async updateProposalVotes (id, epoch) {
    const votes = await runParallel({
      max:     30,
      inputs:  await this.chain.fetchProposalVotes(id),
      process: async vote => {
        const isValidator = vote.isValidator
        const kind  = isValidator ? 'validator' : 'delegator'
        const voter = isValidator ? vote.validator : vote.delegator
        const power = isValidator
          ? await this.chain.fetchValidatorStake(vote.validator, epoch)
          : await this.chain.fetchBondWithSlashing(vote.delegator, vote.validator, epoch)
        console.log(`Epoch ${epoch} proposal ${id} vote by ${kind} ${voter}: ${power}`)
        return {
          proposal: id,
          voter,
          isValidator,
          validator: vote.validator,
          delegator: vote.delegator,
          power
        }
      }
    })
    console.log({votes})
    await DB.default.transaction(async dbTransaction => {
      await Promise.all(votes.map(vote=>DB.Vote.upsert(vote, {transaction: dbTransaction})))
    })
    console.log(`Epoch ${epoch} proposal ${id}:`, votes.length, 'votes updated')
    await waitForever()
  }

  async updateProposal (id, epoch, initTx) {
    console.log('Fetching proposal', id)
    const [proposal, votes, result] = await Promise.all([
      this.chain.fetchProposalInfo(id),
      this.chain.fetchProposalVotes(id),
      this.chain.fetchProposalResult(id),
    ])
    const { id: _, content, ...metadata } = proposal
    if (metadata?.type?.ops instanceof Set) metadata.type.ops = [...metadata.type.ops]
    //console.log({id, votes, content, metadata})
    if (votes.length > 0) {
      await waitForever()
    }
    await DB.withErrorLog(() => DB.default.transaction(async dbTransaction => {
      console.log('Adding proposal', id, 'with', votes.length, 'votes')
      await DB.Proposal.upsert({
        id,
        content,
        metadata,
        result,
        initTx
      }, { transaction: dbTransaction })
      console.log('Adding votes for', id, 'count:', votes.length, 'vote(s)')
      await DB.Vote.destroy({ where: { proposal: id } }, { transaction: dbTransaction })
      for (const vote of votes) {
        console.log('Adding vote for', id)
        await DB.Vote.create({ proposal: id, data: vote }, { transaction: dbTransaction })
      }
    }), { update: 'proposal', id, })
    if (metadata.type?.type === 'DefaultWithWasm') {
      console.log('Fetching WASM for proposal', id)
      const result = await this.chain.fetchProposalWasm(id)
      if (result) {
        const { id, codeKey, wasm } = result
        await DB.withErrorLog(()=> DB.default.transaction(async dbTransaction => {
          console.log('++ Adding proposal WASM for', id, 'length:', wasm.length, 'bytes')
          await DB.ProposalWASM.destroy({ where: { id } }, { transaction: dbTransaction })
          await DB.ProposalWASM.create({ id, codeKey, wasm }, { transaction: dbTransaction })
        }))
      }
    }
    console.log(`Epoch ${epoch} added proposal ${id} with ${votes.length} votes`)
  }

}

function findProposalId (endBlockEvents, txHash) {
  for (const { type, attributes } of endBlockEvents) {
    if (type === 'tx/applied') {
      for (const { key, value } of attributes) {
        if (key === 'hash' && value === txHash) {
          for (const { key, value } of attributes) {
            if (key === 'batch') {
              const batch = JSON.parse(value)
              const { Ok } = Object.values(batch)[0] || {}
              if (Ok) {
                const { events } = Ok
                for (const event of events) {
                  if (event.event_type?.inner === 'governance/proposal/new') {
                    console.log({ found: event.attributes.proposal_id })
                    return event.attributes.proposal_id
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  return null
}
