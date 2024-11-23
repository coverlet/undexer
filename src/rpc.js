import * as Namada from "@fadroma/namada";
import { readFile } from "node:fs/promises";
import { RPC_URL } from './config.js';

let rpc

export default function getRPC () {
  return rpc ??= rpcVariant(RPC_URL)
}

export async function rpcVariant (url) {
  const decoder = await readFile("node_modules/@fadroma/namada/pkg/fadroma_namada_bg.wasm")
  let connection
  while (true) {
    try {
      connection = await Namada.connect({ url, decoder })
      console.log('🪐 Connected to RPC:', url)
      break
    } catch (e) {
      if (e.message === 'must provide a non-empty value') {
        console.error(`💥 RPC empty response (${url}): node is starting`)
      } else if (e.cause) {
        console.error(`💥 RPC connect failed (${url}): ${e.cause.name}: ${e.cause.message} (${e.cause.code})`)
      } else if (e.message.startsWith('Bad status on response')) {
        console.error(`💥 RPC connect failed (${url}): ${e.message}`)
      } else {
        console.error(`💥 RPC connect failed (${url}):`, e)
      }
      await new Promise(resolve=>setTimeout(resolve, 1000))
    }
  }
  return connection
}
