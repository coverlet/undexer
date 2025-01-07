#!/usr/bin/env -S node --import @ganesha/esbuild
await import('./testDb.js')
import process from 'node:process'
import { Console } from "@hackbg/logs"
const console = new Console("Test: API (DB routes)")

const { dbRoutes } = await import('../src/dbRoutes.js')
const testRoute = (route, params = {}, query = {}) =>
  new Promise(resolve=>route({ params, query }, {
    code: null,
    data: null,
    status (code) { this.code = code; return this },
    send (data) { this.data = data; resolve(this) },
  }))
const testDbRoute = async (path, params = {}, query = {}) => {
  const console = new Console(path)
  console.br()
  console.log('/', params, '?', query)
  const route = dbRoutes[path]
  const { code, data } = await testRoute(route, params, query)
  if (code == 200) {
    console.log(code, data)
  } else {
    console.error(code, data)
  }
}

const t1 = performance.now()
try {
  await testDbRoute('/')
  await testDbRoute('/status')
  await testDbRoute('/search')
  await testDbRoute('/block')
  await testDbRoute('/txs')
  await testDbRoute('/tx/:txHash')
  await testDbRoute('/transactions/:address', {
    address: "tnam1qqgccstk66854ffyzytdzue3d593gxxayveecl7e"
  }, { limit: 5 })
  await testDbRoute('/validators')
  await testDbRoute('/validators/states')
  await testDbRoute('/validator')
  await testDbRoute('/validator/votes/:address')
  await testDbRoute('/proposals')
  await testDbRoute('/proposals/stats')
  await testDbRoute('/proposal/:id', { id: "0" })
  await testDbRoute('/proposal/votes/:id', { id: "0" })
  await testDbRoute('/transfers')
  //await testDbRoute('/balances/:address')
  console.log('Tests done in', performance.now() - t1)
  process.exit(0)
} catch (e) {
  console.error(e)
  console.log('Tests failed in', performance.now() - t1)
  process.exit(1)
}

//mock.destroy()
