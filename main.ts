//@ts-types='./fadroma/toolbox/cmds/cmds.ts'
import Commands from "@hackbg/cmds"
import { bold } from "@hackbg/logs"
import type { Console } from "@hackbg/logs"
import process from 'node:process'
//@ts-types='./fadroma/packages/namada/Namada.ts'
import type { Validator } from "@fadroma/namada"

// For examples how to define commands, see:
// https://github.com/hackbg/fadroma/blob/v2/packages/namada/namada.ts
//
// Note that in this module it is preferable to use dynamic imports
// at the top of each command rather than all at the top of the file,
// so that temporary breakage in one code path does not break
// potentially unrelated entrypoints.
export default class UndexerCommands extends Commands {

  declare log: Console // FIXME

  constructor (...args: ConstructorParameters<typeof Commands>) {
    super(...args)
    this.log.label = ''
  }

  api = this.command({
    name: "api",
    info: "run the API server"
  }, () => import('./bin/api.js'))

  indexer = this.command({
    name: "index",
    info: "run the indexer"
  }, () => import('./bin/indexer.js'))

  dbStatus = this.command({
    name: 'db status',
    info: 'show the status of the database'
  }, async () => {
    const DB = await import('./src/db.js')
    console.log('Rows in DB:')
    console.log('Blocks:', await DB.Block.count())
    console.log('Transactions:', await DB.Transaction.count())
    console.log('Validators:', await DB.Validator.count())
    console.log('Proposals:', await DB.Proposal.count())
    console.log('Proposal WASM binaries:', await DB.ProposalWASM.count())
    console.log('Votes:', await DB.Vote.count())
  })

  dbSync = this.command({
    name: "db sync",
    info: "create database"
  }, async () => {
    const { default: db } = await import('./src/db.js')
    this.log.br().log('Trying to sync database schema...')
    await db.sync()
    this.log.br().log('Done.')
  })

  dbSyncDrop = this.command({
    name: "db sync drop",
    info: "UNSAFE: delete and re-create database with latest schema"
  }, async () => {
    const { default: db } = await import('./src/db.js')
    this.log.br().log('Trying to force-sync database schema...')
    await db.sync({ force: true })
    this.log.br().log('Done.')
  })

  dbSyncAlter = this.command({
    name: "db sync alter",
    info: "UNSAFE: alter database to latest schema"
  }, async () => {
    const { default: db } = await import('./src/db.js')
    this.log.br().log('Trying to alter database schema...')
    await db.sync({ alter: true })
    this.log.br().log('Done.')
  })

  queries = this.command({
    name: 'db queries',
    info: 'test all db queries',
  }, async () => {
    for (const [name, item] of Object.entries(await import('./src/dbQuery.js'))) {
      if (typeof item === 'function') {
        this.log.br().log(name)
        this.log(await item())
      }
    }
  })

  blockFetch = this.command({
    name: 'block fetch',
    info: 'fetch and print a block of transactions',
    args: '[HEIGHT]'
  }, async (height?: number) => {
    const t0 = performance.now()
    const { default: getRPC } = await import('./src/rpc.js')
    const chain = await getRPC()
    // Fetch and decode block
    const block = await chain.fetchBlock({ height })
    height ??= block.height
    // Print block and transactions
    this.log.br().log(block)
    for (const transaction of block.transactions) {
      const { hash, data: { batch, sections, content, ...data } } = transaction
      this.log.br()
        .log('Transaction', hash, ':', data)
        .log('Sections of', hash, ':', sections)
        .log('Batched in', hash, ':', batch)
        .log('Content of', hash, ':', content)
    }
    this.log.info('Done in', performance.now() - t0, 'msec')
  })

  blockIndex = this.command({
    name: 'block index',
    info: 'fetch, print, and store a block of transactions',
    args: '[HEIGHT]'
  }, async (height?: number) => {
    const t0 = performance.now()
    const { Updater } = await import('./src/indexUpdater.js')
    const { default: getRPC } = await import('./src/rpc.js')
    const chain = await getRPC()
    // Fetch and decode block
    const block = await chain.fetchBlock({ height })
    height ??= block.height
    // Print block and transactions
    this.log.br().log(block)
    for (const transaction of block.transactions) {
      const { hash, data: { batch, sections, ...data } } = transaction
      this.log.br()
        .log('Transaction', hash, ':', data)
        .log('Sections for', hash, ':', sections)
        .log('Batch in', hash, ':', batch)
    }
    // Write block to database
    this.log.br().log('Syncing database...')
    const { default: db } = await import('./src/db.js')
    await db.sync()
    this.log.br().log('Saving block', height, 'to database...').br()
    const updater = new Updater({ log: this.log, chain })
    await updater.updateBlock({ height, block, })
    this.log.info('Done in', performance.now() - t0, 'msec')
  })

  validatorsFetchList = this.command({
    name: 'validators fetch list',
    info: 'fetch list of validators',
    args: '[EPOCH]'
  }, async (epoch?: string) => {
    const { default: getRPC } = await import('./src/rpc.js')
    const chain = await getRPC()
    const addresses = Object.values(await chain.fetchValidators({
      epoch,
      tendermintMetadata: false,
      namadaMetadata:     false,
    })).map((v: Validator)=>v.namadaAddress).sort()
    if (epoch) {
      this.log.log(`Validators at epoch ${epoch}:`)
    } else {
      this.log.log('Validators at current epoch:')
    }
    for (const address of addresses) {
      this.log.log('Validator:', address)
    }
    this.log
      .log(addresses.length, epoch
        ? `validator(s) at epoch ${epoch}`
        : `validator(s) at current epoch`)
      .br()
      .info("Use the 'validators fetch all' command to get details.")
  })

  validatorsFetchAll = this.command({
    name: 'validators fetch all',
    info: 'fetch detailed info about validators',
    args: '[EPOCH]'
  }, async (epoch?: string) => {
    const { default: getRPC } = await import('./src/rpc.js')
    const chain = await getRPC()
    const validators = Object.values(await chain.fetchValidators({ epoch }))
    const states: Record<string, number> = {}
    for (const validator of validators) {
      this.log.br().log(validator)
      states[(validator as Validator).state?.state]??=0
      states[(validator as Validator).state?.state]++
    }
    this.log.br().info(validators.length, "validators.")
    for (const [state, count] of Object.entries(states)) {
      this.log.info(`${state}:`.padEnd(16), count)
    }
  })

  validatorsUpdate = this.command({
    name: 'validators update',
    info: 'fetch validators and update in db'
  }, async () => {
    const { default: getRPC } = await import('./src/rpc.js')
    const chain = await getRPC()
    const { Updater } = await import('./src/indexUpdater.js')
    const validators = await new Updater({ chain }).updateAllValidators(chain)
    for (const i in validators||[]) {
      console.log(`#${Number(i)+1}:`, validators[i])
    }
  })

  validatorsStates = this.command({
    name: 'validators states',
    info: 'count validators in database by state'
  }, async () => {
    const { callRoute, dbValidatorStates } = await import('./src/routes.js')
    const states = await callRoute(dbValidatorStates)
    console.log({states})
  })

  validatorsQuery = this.command({
    name: 'validators query',
    info: 'query validators from db'
  }, async () => {
    const { validatorsTop } = await import('./src/dbQuery.js')
    const validators = (await validatorsTop()).map(x=>x.toJSON());
    console.log(validators)
    const { routes } = await import('./src/routes.js')
    const dbValidatorByHash = Object.fromEntries(routes)['/validator']
    for (const { publicKey } of validators) {
      console.log(await new Promise((resolve, reject)=>dbValidatorByHash(
        { query: { publicKey, uptime: 100 } },
        { status: (code: number) => ({
            send: (data: unknown) => (code===200)
              ? resolve(data)
              : reject(Object.assign(new Error(`route returned ${code}`), data))
          }) } )))
    }
  })

  becameValidator = this.command({
    name: 'validator query become',
    info: 'query tx_become_validator',
    args: 'ADDRESS',
  }, async (address: string) => {
    const { becomeValidatorCount, becomeValidatorList } = await import('./src/dbQuery.js')
    const t0 = performance.now()
    this.log
      .log(await becomeValidatorCount({ address }),
           'becomeValidator(s) for', bold(address))
      .log(await becomeValidatorList({ address }))
      .log(`Done in ${(performance.now() - t0).toFixed(3)}msec`)
  })

  changedValidatorMetadata = this.command({
    name: 'validator query change metadata',
    info: 'query tx_change_validator_metadata',
    args: 'ADDRESS',
  }, async (validator: string) => {
    const { changeValidatorMetadataCount, changeValidatorMetadataList } = await import('./src/dbQuery.js')
    const t0 = performance.now()
    this.log
      .log(await changeValidatorMetadataCount({ validator }),
           'changeValidatorMetadata(s) for', bold(validator))
      .log(await changeValidatorMetadataList({ validator }))
      .log(`Done in ${(performance.now() - t0).toFixed(3)}msec`)
  })

  deactivatedValidator = this.command({
    name: 'validator query deactivate',
    info: 'query tx_deactivate_validator',
    args: 'ADDRESS',
  }, async (address: string) => {
    const { deactivateValidatorCount, deactivateValidatorList } = await import('./src/dbQuery.js')
    const t0 = performance.now()
    this.log
      .log(await deactivateValidatorCount({ address }),
           'deactivateValidator(s) for', bold(address))
      .log(await deactivateValidatorList({ address }))
      .log(`Done in ${(performance.now() - t0).toFixed(3)}msec`)
  })

  parameters = this.command({
    name: 'parameters',
    info: 'fetch chain parameters'
  }, async () => {
    const { default: getRPC } = await import('./src/rpc.js')
    const chain      = await getRPC()
    const parameters = await chain.fetchProtocolParameters()
    console.log({parameters})
  })

  proposalCount = this.command({
    name: 'proposal count',
    info: 'fetch count of proposals from chain'
  }, () => import('./src/rpc.js')
    .then(({ default: getRPC })=>getRPC())
    .then(chain=>chain.fetchProposalCount())
    .then((count)=>this.log
      .log('Proposals on chain:', count)))

  proposalFetch = this.command({
    name: 'proposal fetch',
    args: 'ID',
    info: 'fetch proposal from chain'
  }, async (id: string) => {
    const chain = await import('./src/rpc.js').then(({ default: getRPC })=>getRPC())
    const data = await chain.fetchProposalInfo(id)
    if (data) {
      this.log.log('Proposal:', data)
      const result = await chain.fetchProposalResult(id)
      this.log.log('Result:',   result)
      if (data.proposal?.type?.type === 'DefaultWithWasm') {
        const wasm = await chain.fetchProposalWasm(id)
        if (wasm) {
          this.log.log('WASM:', wasm.wasm.length, 'bytes')
        }
      }
      let epoch = await chain.fetchEpoch()
      //if (epoch > data.proposal.votingEndEpoch) {
        //epoch = data.proposal.votingEndEpoch
      //}
      for (;epoch > 0n; epoch--) {
        const stake = await chain.fetchTotalStaked(epoch)
        this.log.br().log(`Total stake at ${epoch}:`, stake)
        const votes = await chain.fetchProposalVotes(id, epoch)
        this.log.br().log(`Votes at ${epoch}:`)
        for (const vote of votes) {
          while (true) try {
            if (vote.isValidator) {
              vote.power = await chain.fetchValidatorStake(vote.validator, epoch)
            } else {
              vote.power = await chain.fetchBondWithSlashing(vote.validator, vote.delegator, epoch)
            }
            this.log.log('Vote:', vote)
            break
          } catch (e) {
            console.warn(e)
            console.info('Retrying in 1s...')
            await new Promise(resolve=>setTimeout(resolve, 1000))
          }

          if (vote.power === 1n) process.exit(123)
        }
      }
    } else {
      this.log.error(`Proposal ${id} not found.`)
    }
  })

  proposalIndex = this.command({
    name: 'proposal index',
    args: 'ID',
    info: 'fetch and store proposal from chain'
  }, async (id: string) => {
    const chain = await import('./src/rpc.js').then(({ default: getRPC })=>getRPC())
    const { Updater } = await import('./src/indexUpdater.js')
    const updater = new Updater({ chain })
    await updater.updateProposal(id)
  })

  epoch = this.command({
    name: 'epoch',
    args: '[HEIGHT]',
    info: 'fetch epoch for given or latest block'
  }, (height: string) =>
    import('./src/rpc.js')
      .then(({ default: getRPC })=>getRPC())
      .then(chain=>chain.fetchEpoch({
        height: (height === undefined) ? undefined : Number(height)
      }))
      .then(this.log)
      .catch(this.log.error))

  transfersBy = this.command({
    name: 'transfers by',
    info: 'return transfers for given address',
    args: 'ADDRESS'
  }, async (address: string) => {
    const { transferList } = await import('./src/dbQuery.js')
    const t0 = performance.now()
    console.log(await transferList({ address }))
    console.log(`Done in ${(performance.now() - t0).toFixed(3)}msec`)
  })

  bondsFrom = this.command({
    name: 'bonds from',
    info: 'return bonds from given source',
    args: 'ADDRESS'
  }, async (source: string) => {
    const { bondCount, bondList } = await import('./src/dbQuery.js')
    const t0 = performance.now()
    this.log
      .log(await bondCount({ source }), 'bond(s) from', bold(source))
      .log(await bondList({ source }))
      .log(`Done in ${(performance.now() - t0).toFixed(3)}msec`)
  })

  bondsTo = this.command({
    name: 'bonds to',
    info: 'return bonds to given validator',
    args: 'ADDRESS'
  }, async (validator: string) => {
    const { bondCount, bondList } = await import('./src/dbQuery.js')
    const t0 = performance.now()
    this.log
      .log(await bondCount({ validator }), 'bond(s) to', bold(validator))
      .log(await bondList({ validator }))
      .log(`Done in ${(performance.now() - t0).toFixed(3)}msec`)
  })

  unbondsFrom = this.command({
    name: 'unbonds from',
    info: 'return unbonds from given source',
    args: 'ADDRESS'
  }, async (source: string) => {
    const { unbondCount, unbondList } = await import('./src/dbQuery.js')
    const t0 = performance.now()
    this.log
      .log(await unbondCount({ source }), 'unbond(s) from', bold(source))
      .log(await unbondList({ source }))
      .log(`Done in ${(performance.now() - t0).toFixed(3)}msec`)
  })

  unbondsTo = this.command({
    name: 'unbonds to',
    info: 'return unbonds to given validator',
    args: 'ADDRESS'
  }, async (validator: string) => {
    const { unbondCount, unbondList } = await import('./src/dbQuery.js')
    const t0 = performance.now()
    this.log
      .log(await unbondCount({ validator }), 'unbond(s) to', bold(validator))
      .log(await unbondList({ validator }))
      .log(`Done in ${(performance.now() - t0).toFixed(3)}msec`)
  })

  reindexTransactions = this.command({
    name: 'txs reindex',
    info: 'reindex only blocks containing transactions',
    args: '[MIN_BLOCK]'
  }, async (minHeight: number = 0) => {
    const {Transaction} = await import('./src/db.js')
    const attributes = { include: [ 'blockHeight' ] }
    const where = { /* TODO filter by tx type */ }
    const txs = await Transaction.findAll({ where, attributes })
    const blocks = new Set(txs.map(tx=>tx.get().blockHeight).filter(height=>height>=minHeight))
    this.log(blocks.size, 'blocks containing transaction')
    const { Updater } = await import('./src/indexUpdater.js')
    const chain = await import('./src/rpc.js').then(({ default: getRPC })=>getRPC())
    for (const height of [...new Set(blocks)].sort()) {
      while (true) {
        this.log('Reindexing block', height)
        try {
          const updater = new Updater({ chain })
          await updater.updateBlock({ height, block: undefined })
          break
        } catch (e) {
          console.error(e)
          this.log.error('Failed to reindex block', height, 'retrying in 1s')
          await new Promise(resolve=>setTimeout(resolve, 1000))
        }
      }
    }
  })

  queryTransactions = this.command({
    name: 'txs query',
    info: 'query transactions with given address',
    args: 'ADDRESS'
  }, async (address: string) => {
    const { txWithAddressCount, txWithAddressList } = await import('./src/dbQuery.js')
    const t0 = performance.now()
    this.log
      .log(await txWithAddressCount({ address }), 'tx(s) with', bold(address))
      .log(await txWithAddressList({ address }))
      .log(`Done in ${(performance.now() - t0).toFixed(3)}msec`)
  })

  fetchTotalStake = this.command({
    name: 'total stake',
    info: 'query total staked amount',
    args: '[EPOCH]'
  }, async (epoch?: number|string|bigint) => {
    const { default: getRPC } = await import('./src/rpc.js')
    const chain = await getRPC()
    const stake = await chain.fetchTotalStaked(epoch)
    this.log.log('Total staked:', stake)
  })

}
