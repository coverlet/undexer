//deno-lint-ignore-file no-async-promise-executor
import { Console } from '@fadroma/namada'
import { START_BLOCK, ALLOW_INCOMPLETE } from './config.js'
import { Updater } from './updater.js'
import { RemoteControl } from './remote.js'
import { BlockCounter, EpochCounter } from './counter.js'
import { runForever, retryForever } from './utils.js'

const console = new Console('')
console.debug = () => {}

/** Main indexer controller. */
export class Indexer {
  constructor ({ ws, chain }) {
    this.chain     = chain
    console.debug = this.chain.log.debug = this.chain.connections[0].log.debug = () => {}
    this.updater   = new Updater(console, chain)
    this.remote    = new RemoteControl(chain, ws)
    this.block     = new BlockIndexer(this.updater, this.chain, 0, START_BLOCK||0)
    this.epoch     = new EpochIndexer(this.updater, this.remote, chain, 0, 0)
  }

  async run () {
    await this.remote.socket.connect()
    console('Connected. Starting from block', this.block.inDB)
    this.block.run()
    this.epoch.run()
  }
}

/** Indexes per-block data. */
export class BlockIndexer extends BlockCounter {
  constructor (updater, ...rest) {
    super(...rest)
    this.updater = updater
  }
  run () {
    return runForever(1000, () => this.update())
  }
  async update () {
    await super.update()
    while (this.inDB < this.onChain) {
      const height = this.inDB + 1n
      await retryForever(1000, () => this.updater.updateBlock({ height }))
      await super.update()
    }
  }
}

/** Indexes per-epoch data. */
export class EpochIndexer extends EpochCounter {
  constructor (updater, remote, ...rest) {
    super(...rest)
    Object.assign(this, { updater, remote })
  }
  run () {
    return runForever(1000, () => this.update())
  }
  async update () {
    await super.update()
    if (this.inDB < this.onChain - 2n) {
      if (ALLOW_INCOMPLETE) {
        console.warn(
          `DB is >2 epochs behind chain (DB ${this.inDB}, `+
          `chain ${this.onChain}). Historical data may be inaccurate! `+
          `Run with ALLOW_INCOMPLETE=0 to force resync.`
        )
      } else {
        console.warn(
          `🚨🚨🚨 DB is >2 epochs behind chain (DB ${this.inDB}, `+
          `chain ${this.onChain}). Resyncing node from block 1!`
        )
        await this.remote.restart()
      }
    }
    if (this.changed) {
      const epoch = await this.chain.fetchEpoch()
      await Promise.all([
        retryForever(1000, ()=>this.updater.updateTotalStake(epoch)),
        retryForever(1000, ()=>this.updater.updateAllValidators(epoch)),
        //retryForever(1000, this.updater.updateGovernance.bind(this.updater, epoch)),
      ])
      this.changed = false
    }
    if (await this.remote.isPaused()) {
      this.log('🟢 Resuming sync')
      await this.remote.resume()
    }
  }
}
