#!/usr/bin/env -S node --import @ganesha/esbuild
import { Console } from "@hackbg/logs"
const console = new Console("Undexer Test Suite")
import process from 'node:process'
import { PostgresMock } from "pgmock"
import { freePort } from "@hackbg/port"
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
console.log('Mock database ready.')
mock.destroy()
