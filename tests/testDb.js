import { Console } from "@hackbg/logs"
const console = new Console("Test: pgmock setup")
import process from 'node:process'
import { PostgresMock } from "pgmock"
import { freePort } from "@hackbg/port"

if (process.env.PGMOCK) {
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
} else if (!process.env.DATABASE_URL) {
  throw new Error('either PGMOCK or DATABASE_URL must be set')
}
