import { Console } from '@fadroma/namada'
import { retryForever, runParallel } from './utils.js'

const console = new Console('')

export class Fetcher {
  constructor ({ log, chain }) {
    this.log   = log
    this.chain = chain
  }

  fetchTotalStake (epoch) {
    return retryForever(1000, () => this.chain.fetchTotalStaked({ epoch }))
  }

  fetchBlock (height) {
    return retryForever(1000, () => this.chain.fetchBlock({ height, raw: true }))
  }
  
  fetchBlockResults (height) {
    return retryForever(1000, () => this.chain.fetchBlockResults({ height }))
  }

  fetchEpoch (height) {
    return retryForever(1000, () => this.chain.fetchEpoch({ height }))
  }

  async fetchCurrentAndPastConsensusValidatorAddresses (epoch) {
    const [currentConsensusValidators, previousConsensusValidators] = await Promise.all([
      this.chain.fetchValidatorsConsensus(epoch),
      (epoch > 0n) ? await this.chain.fetchValidatorsConsensus(epoch - 1n) : Promise.resolve([])
    ])
    return new Set([
      ...currentConsensusValidators.map(y=>y.address),
      ...previousConsensusValidators.map(y=>y.address),
    ])
  }

  async fetchRemainingValidatorAddresses (consAddrs, epoch) {
    const allAddrs = await this.chain.fetchValidatorAddresses(epoch)
    return allAddrs.filter(x=>!consAddrs.has(x))
  }

  async fetchValidators (inputs, epoch) {
    const iterator   = this.chain.fetchValidatorsIter({ epoch: Number(epoch), addresses: inputs })
    const process    = async _ => (await iterator.next()).value
    const validators = await runParallel({ max: 50, inputs, process })
    console.log({validators})
    return validators
  }

  async fetchProposalVotes (id, epoch) {
    const votes = await this.chain.fetchProposalVotes(id)
    return await runParallel({
      max:     30,
      inputs:  votes,
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
  }
}
