import { Console } from '@fadroma/namada'
import * as DB from './db.js'
import { Fetcher } from './fetcher.js'
import { runParallel } from './utils.js'

const console = new Console('')

/** Fetches data using the `Fetcher` and writes it into the `DB`. */
export class Updater {

  constructor (log, chain) {
    this.log     = log
    this.chain   = chain
    this.fetcher = new Fetcher({ log, chain })
  }

  async updateTotalStake (epoch) {
    this.log("Updating total stake at epoch", epoch)
    const total = await this.fetcher.fetchTotalStake({ epoch })
    console.log('Epoch', epoch, 'total stake:', total)
  }

  async updateAllValidators (epoch) {
    const t0 = performance.now()
    this.log("Updating validators at epoch", epoch)

    const consAddrs = await this.fetcher.fetchCurrentAndPastConsensusValidatorAddresses(epoch)
    const consVals  = await this.fetcher.fetchValidators(consAddrs, epoch)
    await this.updateValidators(consVals, epoch)
    console.log('Epoch', epoch, `updated`, consVals.length,
                `consensus validators in`, ((performance.now()-t0)/1000).toFixed(3), 's')

    const otherAddrs = await this.fetcher.fetchRemainingValidatorAddresses(consAddrs, epoch)
    const otherVals  = await this.fetcher.fetchValidators(otherAddrs, epoch)
    await this.updateValidators(otherVals, epoch)
    console.log('Epoch', epoch, `updated`, otherVals.length,
                `validators total in`, ((performance.now()-t0)/1000).toFixed(3), 's')
  }

  async updateValidators (inputs, epoch) {
    await DB.default.transaction(transaction=>runParallel({
      max: 50, inputs, process: validator => DB.Validator.upsert(
        Object.assign(validator, { epoch }),
        { transaction }
      )
    }))
  }

  async updateValidator (address, epoch) {
    const validator = await this.chain.fetchValidator(address, { epoch })
    await DB.Validator.upsert(Object.assign(validator, { epoch }))
  }

  /** Update a single block in the database. */
  async updateBlock ({ height, block }) {
    const t0 = performance.now()

    // If no block was passed, fetch it.
    block ??= await this.fetcher.fetchBlock(height)

    // Make sure there isn't a mismatch between required and actual height.
    height = block.height

    // Fetch epoch number and block results
    const [epoch, blockResults] = await Promise.all([
      this.fetcher.fetchEpoch(height),
      this.fetcher.fetchBlockResults(height)
    ])
    this.log.br().log(`Block ${height} (epoch ${epoch})`)

    // Things that need to be updated separately after the block. This is because
    // if we try to fetch them during the block update, the db transaction would time out.
    const votedProposals    = new Set()
    const updatedValidators = new Set()

    // Update the block and the contained transaction.
    await DB.default.transaction(async transaction => {
      // Update block record
      const data = {
        chainId:      block.header.chainId,
        blockTime:    block.time,
        blockHeight:  block.height,
        blockHash:    block.hash,
        blockHeader:  block.header,
        blockData:    JSON.parse(block.responses?.block.response||"null"),
        blockResults: JSON.parse(block.responses?.results?.response||"null"),
        rpcResponses: block.responses,
        epoch,
      }
      await DB.Block.upsert(data, { transaction })
      // Update transaction records from block
      for (const tx of block.transactions) await this.updateTx(tx, {
        epoch, height, blockResults, votedProposals, updatedValidators, transaction
      })
    })

    // Update post-fetched things.
    await this.updateValidators([...updatedValidators], epoch)
    for (const id of [...votedProposals]) await this.updateProposalVotes(id, epoch)

    // Log performed updates.
    const t = performance.now() - t0
    this.log(`Block ${height} (epoch ${epoch}): added in`, t.toFixed(0), 'msec')
  }

  /** Update a single transaction in the database. */
  async updateTx (tx, options) {
    const { epoch, height, transaction, } = options
    this.log(`Block ${height} (epoch ${epoch})`,
             `TX ${tx.data?.content?.type}`, transaction.id)
    await this.updateTxContent(tx, options)
    await DB.Transaction.upsert({
      chainId:     tx.data.chainId,
      blockHash:   tx.block.hash,
      blockTime:   tx.block.time,
      blockHeight: tx.block.height,
      txHash:      tx.id,
      txTime:      tx.data.timestamp,
      txType:      tx.data.content.type,
      txContent:   tx.data.content.data,
      txData:      tx, // TODO deprecate
    }, { transaction })
  }

  async updateTxContent (tx, options) {
    const { epoch, height, blockResults, votedProposals, updatedValidators, transaction } = options
    const { type: txType, data: txData } = tx.data?.content || {}
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
        console.log(`Block ${height} (epoch ${epoch}): Will update validator`, txData.validator)
        updatedValidators.add(txData.validator)
        break
      }
      case "tx_init_proposal.wasm": {
        const { content, ...metadata } = txData || {}
        const id = findProposalId(blockResults.endBlockEvents, tx.id)
        if (id) {
          console.log(`Block ${height} (epoch ${epoch}): New proposal`, id)
          const data = { id, content, metadata, initTx: tx.id }
          await DB.Proposal.upsert(data, {transaction})
        } else {
          console.log(`Block ${height} (epoch ${epoch}): New proposal, unknown id, updating all`)
          await this.updateGovernance()
        }
        break
      }
      case "tx_vote_proposal.wasm": {
        console.log(`Block ${height} (epoch ${epoch}) Vote on`, txData.id, 'by', txData.voter)
        votedProposals.add(txData.id)
        const data = { proposal: txData.id, voter: txData.voter, vote: txData.vote, voteTx: tx.id }
        await DB.Vote.upsert(data, {transaction})
        break
      }
    } else {
      console.warn("No supported TX content in", tx.id)
    }
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
    await DB.withErrorLog(() => DB.default.transaction(async transaction => {
      console.log('Adding proposal', id, 'with', votes.length, 'votes')
      const fields = { id, content, metadata, result, initTx }
      await DB.Proposal.upsert(fields, {transaction})
      console.log('Adding votes for', id, 'count:', votes.length, 'vote(s)')
      await DB.Vote.destroy({ where: { proposal: id } }, {transaction})
      for (const vote of votes) {
        console.log('Adding vote for', id)
        await DB.Vote.create({ proposal: id, data: vote }, {transaction})
      }
    }), { update: 'proposal', id, })

    if (metadata.type?.type === 'DefaultWithWasm') await this.updateProposalWasm(id)
    console.log(`Epoch ${epoch} added proposal ${id} with ${votes.length} votes`)
  }

  async updateProposalVotes (id, epoch) {
    const votes = await this.fetcher.fetchProposalVotes(id, epoch)
    await DB.default.transaction(async transaction => {
      await Promise.all(votes.map(vote=>DB.Vote.upsert(vote, {transaction})))
    })
    console.log(`Epoch ${epoch} proposal ${id}:`, votes.length, 'votes updated')
    await waitForever()
  }

  async updateProposalWasm (id) {
    console.log('Fetching WASM for proposal', id)
    const result = await this.chain.fetchProposalWasm(id)
    if (result) {
      const { id, codeKey, wasm } = result
      await DB.withErrorLog(()=> DB.default.transaction(async transaction => {
        console.log('++ Adding proposal WASM for', id, 'length:', wasm.length, 'bytes')
        await DB.ProposalWASM.destroy({ where: { id } }, { transaction })
        await DB.ProposalWASM.create({ id, codeKey, wasm }, { transaction })
      }))
    }
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
