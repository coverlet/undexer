#!/usr/bin/env -S node --import @ganesha/esbuild
import express from 'express';
import cors from 'cors';
import sequelize from '../src/db.js';
import process from 'node:process'
import router from '../src/routes.js';
const { SERVER_PORT = 8888 } = process.env
console.log(`⏳ Launching server on port ${SERVER_PORT}...`)
console.log('⏳ Syncing DB schema...')
await sequelize.sync();
express()
  .use(cors())
  .use('/v4', router)
  .listen({ port: SERVER_PORT }, () => {
    console.log(`🚀 Server ready at http://0.0.0.0:${SERVER_PORT}`);
  });
