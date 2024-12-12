#!/usr/bin/env -S node --import @ganesha/esbuild
import process from 'node:process';
import express from 'express';
import cors from 'cors';
import db, { initDb } from '../src/db.js';
import { addDbRoutes } from '../src/dbRoutes.js';
import { addRpcRoutes } from '../src/rpcRoutes.js';
import { rpcVariant } from '../src/rpc.js';

const { SERVER_PORT = 8888, RPCS } = process.env
const rpcUrls = RPCS ? RPCS.split(',').map(x=>x.trim()) : [
  //'https://rpc.namada-dryrun.tududes.com/',
  'https://namada-rpc.mandragora.io',
];
if (rpcUrls.length > 0) {
  console.log('🪐 Using', rpcUrls.length, 'RPC url(s):')
  for (const rpcUrl of rpcUrls) console.log('🪐 -', rpcUrl)
} else {
  console.error('No RPC URLs configured. Exiting.')
  process.exit(1)
}
const rpcs = rpcUrls.map(rpcVariant)
console.log(`⏳ Launching server on port ${SERVER_PORT}...`)
console.log('⏳ Syncing DB schema...')
await initDb();
await db.sync();
const router = express.Router();
addRpcRoutes(router, rpcs)
addDbRoutes(router)
express()
  .use(cors())
  .use('/v4', router)
  .listen({ port: SERVER_PORT }, () => {
    console.log(`🚀 Server ready at http://0.0.0.0:${SERVER_PORT}`);
  });
