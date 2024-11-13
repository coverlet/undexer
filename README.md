# Undexer

This is the Undexer. It decodes historical data from a [Namada](https://namada.net/)
node, and caches it into PostgreSQL, so that you don't have to.

Undexer is the pilot project for [Fadroma 2.0](https://github.com/hackbg/fadroma/).
See [`@fadroma/namada`](https://github.com/hackbg/fadroma/tree/v2/packages/namada)
and [`@hackbg/borshest`](https://github.com/hackbg/toolbox/tree/main/borshest).

## API reference and endpoints

For all endpoints available please refer to the [OpenAPI specs](swagger.yaml).

* **API v4 (current):** https://undexer.hack.bg/v4
  * TODO: changelog

* **API v3 (deprecated):** https://undexer-v3.demo.hack.bg/v3/
  * `/block` endpoint: removed `blockHeader`, added `proposer` and `signers`

* **API v2 (decommissioned):** https://undexer.demo.hack.bg/v2/

* **API v1 (decommissioned).**

## Running

### Dockerless staging deployment

Requires:

* Git
* Node.js (tested with 22.3.0)
* PNPM (tested with 9.4.0)
* Rust (tested with 1.79.0)
* wasm-pack (tested with 0.12.1)
* protoc (tested with 25.3)
* PostgreSQL (tested with 16.2)

Setup:

```sh
git clone --recursive https://github.com/hackbg/undexer
cd undexer
pnpm i
pnpm build:wasm:dev # or pnpm build:wasm:prod
pnpm start # concurrently runs api and indexer
```

* You may need to create an `.env` file to provide at least `DATABASE_URL` (for connecting
  to your PostgreSQL instance). See `src/config.js` for other environment variables.

* You can use Docker Compose to launch Postgres and hack on the rest outside of the container.

### Dockerized staging deployment

Requires:

* Git
* Docker (tested with 24.0.9)
* Docker Compose (tested with 2.28.1, should come built-in to Docker)
* [Just](https://github.com/casey/just) (**optional but recommended**; tested with 1.29.1)

Setup:

```sh
git clone --recursive https://github.com/hackbg/undexer
cd undexer
just up # or `docker compose up`, etc.
```

### Production deployment

* We use NixOS/systemd/Docker to run this in production.

* Undexer does not manage TLS certificates or terminate HTTPS.
  We use NGINX and automatic ACME/LetsEncrypt cert management provided by NixOS.

## Troubleshooting

### The submodule

`./fadroma` is a Git submodule. Handle accordingly. For example, if the directory is empty,
this usually means you cloned the Undexer repo without submodules. To populate it, use:

```bash
git submodule update --init --recursive
```

### Others

If you catch anything breaking, get in touch by filing an issue or PR in this repository.
