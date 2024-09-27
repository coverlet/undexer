import { Console } from '@fadroma/namada'
const console = new Console('')

export class RemoteControl {
  constructor (chain, ws, api = 'http://localhost:25555/') {
    this.api = api
    this.ws = ws

    this.chain = chain
    this.chain.log.debug = () => {}
    this.chain.connections[0].log.debug = () => {}
    this.socket = new ReconnectingWebSocket(ws)
  }

  async isPaused () {
    const status = await (await fetch(this.api)).json()
    return !status.services.proxy
  }

  async resume () {
    const socket = await this.socket.socket
    console.log('Resume sync')
    socket.send(JSON.stringify({resume:{}}))
  }

  async restart () {
    const socket = await this.socket.socket
    console.log('Restart sync')
    socket.send(JSON.stringify({restart:{}, resume:{}}))
  }
}

export class ReconnectingWebSocket {
  constructor (url) {
    this.url = url
  }

  connect (backoff = 0) {
    return this.socket = new Promise(async resolve => {
      if (backoff > 0) {
        console.log('Waiting for', backoff, 'msec before connecting to socket...')
        await new Promise(resolve=>setTimeout(resolve, backoff))
      }
      try {
        console.log('Connecting to', this.url)
        const socket = new WebSocket(this.url)

        socket.addEventListener('open', () => {
          console.log('Connected to', this.url)
          backoff = 0
          resolve(socket)
        })

        socket.addEventListener('close', () => {
          console.log('Disconnected from', this.url, 'reconnecting...')
          this.socket = this.connect(backoff + 250)
        })

        socket.addEventListener('message', message => {})

      } catch (e) {
        console.error(e)
        console.error('Failed to connect to', this.url, 'retrying in 1s')
        this.socket = this.connect(backoff + 250)
      }
    })
  }
}

