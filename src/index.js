import { Console } from '@fadroma/namada'
import * as Config from './config.js'
import * as Query from './dbQuery.js'
import { Updater } from './indexUpdater.js'
import { Fetcher } from './indexFetcher.js'
import { RemoteControl } from './indexRemote.js'
import { Logged, runForever, retryForever, maxBigInt } from './utils.js'

const console = new Console('')
console.debug = () => {}

/** Main indexer controller. */
export class Indexer extends Logged {
  constructor ({
    chain, // NamadaChain instance from Fadroma.
    proxyApi = Config.PROXY_CONTROL_URL,
    nodeApi  = Config.NODE_CONTROL_URL,
    log      = console,
  } = {}) {
    super({ log })
    // Mute debug logging.
    this.log.debug = () => {}
    // Enable fetching well-formed data from the chain.
    this.fetcher = new Fetcher({ log, chain })
    // Enable copying data from the chain into the DB.
    this.updater = new Updater({ log, fetcher: this.fetcher })
    // Enable pausing and resyncing the node.
    this.remote  = new RemoteControl({ log, chain, proxyApi, nodeApi })
    // Initialize counters
    this.blockOnChain    = 0n
    this.blockInDatabase = 0n
    this.epochOnChain    = 0n
    this.epochInDatabase = 0n
  }

  async run () {
    // Connect to remote control sockets (for pausing/unpausing/resyncing node)
    await this.remote.connect()
    // Query latest indexed block and epoch from DB
    this.blockInDatabase = await maxBigInt(Config.START_BLOCK, BigInt(await Query.latestBlock()||0))
    this.epochInDatabase = BigInt(await Query.latestEpochForValidators()||0)
    this.logEH(this.epochInDatabase, this.blockInDatabase, 'Starting')
    return runForever(1000, () => this.update())
  }

  async update () {
    // Update block counter.
    this.blockOnChain    = BigInt(await this.fetcher.fetchHeight())
    this.blockInDatabase = maxBigInt(Config.START_BLOCK, BigInt(await Query.latestBlock()||0))
    this.log(
      `Block`, this.blockInDatabase, `/`, this.blockOnChain, 
      `(${(this.blockOnChain - this.blockInDatabase)} behind)`
    )
    // Update block data, transactions, validators, proposals, votes.
    if (this.blockInDatabase < this.blockOnChain) {
      const height = this.blockInDatabase + 1n
      await retryForever(1000, () => this.updater.updateBlock({ height }))
    }

    // TODO: update total stake in block or epoch?
    // TODO: reindex all validators once per epoch?
    // TODO: reindex all proposals/votes once per epoch?

    // Update epoch counter.
    this.epochOnChain    = BigInt(await this.fetcher.fetchEpoch(this.blockOnChain))
    this.epochInDatabase = BigInt(await Query.latestEpochForValidators()||0)
    this.log(
      `Epoch`, this.epochInDatabase, `/`, this.epochOnChain,
      `(${(this.epochOnChain - this.epochInDatabase)} behind)`
    )
    // If we are more than 2 epochs behind the chain,
    // correct values for certain fields become impossible to fetch.
    // So we have to trigger a full resync of the local node.
    if (this.epochInDatabase < this.epochOnChain - 2n) {
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
    // FIXME: Not call this too early
    if (await this.remote.isPaused()) {
      console.log('🟢 Resuming sync')
      await this.remote.resume()
    }
  }
}
