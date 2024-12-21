# Build the WASM blob
from oci.hack.bg/platform-alpine:latest as wasm
  workdir /build/fadroma-namada
  copy ./fadroma/packages/namada/Cargo.toml ./fadroma/packages/namada/Cargo.lock .
  run cat Cargo.toml && mkdir -p src && touch src/lib.rs && PATH=$PATH:~/.cargo/bin cargo fetch
  copy ./fadroma/packages/namada/src ./src
  run PATH=$PATH:~/.cargo/bin wasm-pack build --release --target web \
   && rm -rf target

# Build the app container
from oci.hack.bg/runtime-alpine:latest as prod
  workdir /app
  user 0
  add package.json pnpm-lock.yaml .
  run pnpm --version && corepack install && pnpm --version #&& corepack up && pnpm --version
  run pnpm fetch -P --stream
  add . ./
  run pnpm -r i -P --frozen-lockfile
  run pwd && ls -al
  copy --from=wasm /build/fadroma-namada/pkg/fadroma_namada_bg.wasm ./fadroma/packages/namada/pkg/fadroma_namada_bg.wasm
  user 1000
  run pwd && ls -al
