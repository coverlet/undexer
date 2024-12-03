#!/usr/bin/env -S node --import @ganesha/esbuild
await import('./testDb.js')
import { Console } from "@hackbg/logs"
const console = new Console("Test: API (DB routes)")

const { dbRoutes } = await import('../src/dbRoutes.js')
const testRoute = (route, query = {}) =>
  new Promise(resolve=>route({ query }, {
    code: null,
    data: null,
    status (code) { this.code = code; return this },
    send (data) { this.data = data; resolve(this) },
  }))
const testDbRoute = async (path, query) => {
  console.log('Testing', path, query)
  console.log(await testRoute(dbRoutes[path], query))
}

const t1 = performance.now()
try {
  await testDbRoute('/')
  await testDbRoute('/status')
  await testDbRoute('/search')
  await testDbRoute('/block')
  await testDbRoute('/txs')
  await testDbRoute('/tx/:txHash')
  //await testDbRoute('/validators')
  await testDbRoute('/validators/states')
  await testDbRoute('/validator')
  await testDbRoute('/validator/votes/:address')
  await testDbRoute('/proposals')
  await testDbRoute('/proposals/stats')
  await testDbRoute('/proposal/:id')
  await testDbRoute('/proposal/votes/:id')
  await testDbRoute('/transfers')
  await testDbRoute('/transactions/:address')
  await testDbRoute('/balances/:address')
  console.log('Tests done in', performance.now() - t1)
  process.exit(0)
} catch (e) {
  console.error(e)
  console.log('Tests failed in', performance.now() - t1)
  process.exit(1)
}

//mock.destroy()
