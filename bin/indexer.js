#!/usr/bin/env -S node --import=@ganesha/esbuild

import { Console } from '@hackbg/fadroma'
const console = new Console('Undexer')
console.log('⏳ Starting at', new Date())
console.log('⏳ Patching globalThis.fetch...')

import '../src/fetch.js'
console.log('⏳ Syncing DB schema...')

import db from '../src/db.js'
import { START_FROM_SCRATCH } from '../src/config.js'
await db.sync({ force: Boolean(START_FROM_SCRATCH) })
console.log('🚀 Begin indexing!')

import { CONTROL_URL } from "../src/config.js"
import { ControllingBlockIndexer } from '../src/block.js'
console.log('⏳ Connecting...')

import getRPC from "../src/rpc.js"
const indexer = new ControllingBlockIndexer({ chain: await getRPC(), ws: CONTROL_URL })
indexer.run()
