#!/usr/bin/env -S node --import=@ganesha/esbuild

import { Console } from '@hackbg/fadroma'
const console = new Console('Undexer')
console.log('⏳ Starting at', new Date())

console.log('⏳ Patching globalThis.fetch...')
// Prevents `UND_ERR_CONNECT_TIMEOUT`. See:
// - https://github.com/nodejs/undici/issues/1531
// - https://github.com/nodejs/node/issues/43187#issuecomment-2089813900
import { fetch, setGlobalDispatcher, Agent } from 'undici'
setGlobalDispatcher(new Agent({ connect: { timeout: 300_000 } }) )
globalThis.fetch = fetch

console.log('⏳ Syncing DB schema...')
import db from '../src/db.js'
import { START_FROM_SCRATCH } from '../src/config.js'
await db.sync({ force: Boolean(START_FROM_SCRATCH) })
console.log('🚀 Begin indexing!')

import { CONTROL_URL } from "../src/config.js"
import { Indexer } from '../src/main.js'
console.log('⏳ Connecting...')

import getRPC from "../src/rpc.js"
const indexer = new Indexer({ chain: await getRPC(), ws: CONTROL_URL })
indexer.run()
