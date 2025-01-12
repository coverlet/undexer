#!/usr/bin/env -S node --import @ganesha/esbuild
import './testDb.js'
import { Console } from "@hackbg/logs"
const console = new Console("Test: Indexing")
import { Indexer } from '../src/index.js'
new Indexer({
  log: console,
  chain: {
    log: console,
    connections: [ { log: console } ]
  }
})
