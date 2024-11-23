import { Console } from '@fadroma/namada'
import { START_BLOCK } from './config.js'
import * as Query from './dbQuery.js'
import { retryForever, maxBigInt } from './utils.js'

const console = new Console('')

/** Tracks indexing progress. */
export class Counter {
  constructor (onChain, inDB) {
    Object.assign(this, { onChain: BigInt(onChain), inDB: BigInt(inDB) })
  }
}

/** Tracks indexing progress for blocks. */
export class BlockCounter extends Counter {
  constructor (chain, ...rest) {
    super(...rest)
    this.chain = chain
  }

  async update () {
    const [inDB, onChain] = await Promise.all([this.updateInDB(), this.updateOnChain()])
    console.log(`Block ${inDB} of ${onChain} (${(onChain - inDB)} behind)`)
  }
  updateInDB () {
    return retryForever(1000, async () => {
      return this.inDB = maxBigInt(START_BLOCK, BigInt(await Query.latestBlock()||0))
    })
  }
  updateOnChain () {
    return retryForever(1000, async () => {
      return this.onChain = await this.chain.fetchHeight()
    })
  }
}

/** Tracks indexing progress for epochs. */
export class EpochCounter extends Counter {
  constructor (chain, ...rest) {
    super(...rest)
    this.chain = chain
  }

  changed = false

  async update () {
    const [inDB, onChain] = await Promise.all([this.updateInDB(), this.updateOnChain()])
    if (onChain != inDB) {
      this.changed = true
      console.br().log(`Epoch ${inDB} of ${onChain} (${(onChain - inDB)} behind)`)
    }
  }
  updateInDB () {
    return retryForever(1000, async () => {
      return this.inDB    = BigInt(await Query.latestEpochForValidators()||0)
    })
  }
  updateOnChain () {
    return retryForever(1000, async () => {
      return this.onChain = BigInt(await this.chain.fetchEpoch())
    })
  }
}
