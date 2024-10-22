//deno-lint-ignore-file no-async-promise-executor
import { Console } from '@fadroma/namada'
const console = new Console('')

/** Remote control for node and node-out proxy. */
export class RemoteControl {
  constructor ({
    chain,
    proxyApi = 'http://node-out:25552/',
    nodeApi  = 'http://node:25551'
  } = {}) {
    this.proxyApi = proxyApi
    const proxyWs = Object.assign(new URL(proxyApi), { protocol: 'ws:' }).href
    this.proxyWs  = new ReconnectingWebSocket(proxyWs)

    this.nodeApi = nodeApi
    const nodeWs = Object.assign(new URL(nodeApi), { protocol: 'ws:' }).href
    this.nodeWs  = new ReconnectingWebSocket(nodeWs)

    this.chain = chain
    this.chain.log.debug = () => {}
    this.chain.connections[0].log.debug = () => {}
  }

  async isPaused () {
    const status = await (await fetch(this.proxyApi)).json()
    return !status
  }

  async resume () {
    console.log('🟢 Sending resume sync command', this.proxyApi)
    ;(await this.proxyWs.socket).send(JSON.stringify({resume:{}}))
  }

  async restart () {
    console.log('🟠 Sending restart sync to', this.nodeApi)
    ;(await this.nodeWs.socket).send(JSON.stringify({restart:{}}))
    await this.resume()
  }
}

export class ReconnectingWebSocket {
  constructor (url) {
    this.url = url
  }

  connect (backoff = 0) {
    return this.socket = new Promise(async (resolve, reject) => {
      if (backoff > 0) {
        console.log('Waiting for', backoff, 'msec before connecting to socket...')
        await new Promise(resolve=>setTimeout(resolve, backoff))
      }
      try {
        console.log('Connecting to', this.url)
        const socket = new WebSocket(this.url)

        const onConnectError = (error) => {
          console.error(`🔴 Error connecting to ${this.url}:`, error)
          reject(error)
        }
        socket.addEventListener('error', onConnectError)

        socket.addEventListener('open', () => {
          socket.removeEventListener('error', onConnectError)
          console.log('Connected to', this.url)
          backoff = 0
          resolve(socket)
        })

        socket.addEventListener('close', () => {
          console.log('Disconnected from', this.url, 'reconnecting...')
          this.socket = this.connect(backoff + 250)
        })

        //socket.addEventListener('message', message => {})

      } catch (e) {
        console.error(e)
        console.error('Failed to connect to', this.url, 'retrying in 1s')
        this.socket = this.connect(backoff + 250)
      }
    })
  }
}

