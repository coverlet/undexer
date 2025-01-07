#!/usr/bin/env -S node --import @ganesha/esbuild
await Promise.all([
  import('./testApiDb.js'),
  import('./testApiRpc.js'),
])

