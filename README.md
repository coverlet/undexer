| 😀 | important announcement |
| - | - |
| ![](https://raw.githubusercontent.com/hackbg/undexer/refs/heads/v4/tests/.kibosh.png) | **problems running undexer?** you don't say. we'd be happy to look into it; however as our telepath department is currently undertaking security training we implore you to [eagerly report any issues you may encounter in this form](github.com/hackbg/undexer/issues/new), with as many words, screenshots, log pastes, etc. as you can manage. this is the most actionable way to get them resolved. plus, it provides us with insights about undexer usage in the wild!|

---

# Undexer

This is the Undexer. It decodes historical data from a [Namada](https://namada.net/)
node, and caches it into PostgreSQL, so that you don't have to.

Undexer is the pilot project for [Fadroma 2.0](https://github.com/hackbg/fadroma/).
See [`@fadroma/namada`](https://github.com/hackbg/fadroma/tree/v2/packages/namada)
and [`@hackbg/borshest`](https://github.com/hackbg/toolbox/tree/main/borshest).

## API reference and endpoints

The current version of the Undexer API is 4+.
You can find it at https://undexer.hack.bg/v4.

The API definition a living standard.
The [OpenAPI specs](swagger.yaml) are deprecated, please refer to them with caution.
See https://github.com/hackbg/undexer/issues/18.

The API is initialized [here](./bin/api.js). Therefore, for up-to-date information
on what routes the Undexer API contains and what they do, please refer to:

* [`./src/dbRoutes.js`](./src/dbRoutes.js)
* [`./src/rpcRoutes.js`](./src/rpcRoutes.js)

|  | protip |
| - | - |
| 😀 |For example, you can integrate these route definitions with something that serves Swagger, and send us a PR fixing #18!|

* **API v4 (current):** https://undexer.hack.bg/v4
  * TODO: changelog

* **API v3 (deprecated):** https://undexer-v3.demo.hack.bg/v3/
  * `/block` endpoint: removed `blockHeader`, added `proposer` and `signers`

* **API v2 (decommissioned):** https://undexer.demo.hack.bg/v2/

* **API v1 (decommissioned).**

## Dockerless staging deployment

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

## Dockerized staging deployment

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

## Production deployment

We use NixOS/systemd/Docker to run this in production. Thus, Undexer does not manage TLS certificates or terminate HTTPS.
We use NGINX and automatic ACME/LetsEncrypt cert management provided by NixOS.

|  |  |
| - | - |
| 😀 |For example, you can let us know how you run Undexer in production, so that we can provide more detailed deployment and troubleshooting instructions for different environments!|

## Troubleshooting

### The submodule

`./fadroma` is a Git submodule. Handle accordingly. For example, if the directory is empty,
this usually means you cloned the Undexer repo without submodules. To populate it, use:

```bash
git submodule update --init --recursive
```

### Others

If you catch anything breaking, get in touch by filing an issue or PR in this repository.
