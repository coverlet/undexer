#!/usr/bin/env -S node --import @ganesha/esbuild
import { Console } from "@hackbg/logs"
const console = new Console("Undexer Test Suite")
import process from 'node:process'
import { PostgresMock } from "pgmock"
import { freePort } from "@hackbg/port"

const t0 = performance.now()
const port = await freePort()
const mock = await PostgresMock.create()
const conn = await mock.listen(port)
console.log("Listening on", port)
console.log("Connection string:", conn)
process.env.CHAIN_ID = "postgres"
process.env.DATABASE_URL = conn
console.log('Importing database module...')
const { default: db, initDb } = await import('../src/db.js')
console.log('Setting up mock database...')
await initDb()
console.log('Syncing mock DB schema...')
await db.sync()
console.log('Mock database ready in', performance.now() - t0)

const { dbRoutes } = await import('../src/dbRoutes.js')
const testRoute = (route, query = {}) =>
  new Promise(resolve=>route({ query }, {
    code: null,
    data: null,
    status (code) { this.code = code; return this },
    send (data) { this.data = data; resolve(this) },
  }))
const testDbRoute = (path, query) => testRoute(dbRoutes[path], query)

const t1 = performance.now()
console.log(await testDbRoute('/'))
console.log('Tests done in', performance.now() - t1)

mock.destroy()
