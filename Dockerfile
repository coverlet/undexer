FROM rust:1.79-alpine3.20@sha256:cc9b42c44d37caccb8f7c366f19f5a41ca0f20f826fb043be073167308b6073d as wasm

RUN apk add musl-dev protoc protobuf-dev openssl-dev cmake build-base binaryen
RUN rustup target add wasm32-unknown-unknown
RUN cargo install wasm-pack@0.13.1

WORKDIR /build/fadroma-namada
COPY ./fadroma/packages/namada/Cargo.toml ./fadroma/packages/namada/Cargo.lock .
RUN cat Cargo.toml && mkdir -p src && touch src/lib.rs && cargo fetch
COPY ./fadroma/packages/namada/src ./src
RUN PATH=$PATH:~/.cargo/bin wasm-pack build --release --target web \
 && rm -rf target

FROM node:22.4-alpine3.20

RUN apk add git
WORKDIR /app
ADD . ./
RUN pwd && ls -al
RUN npm i -g pnpm
RUN pnpm i --frozen-lockfile

COPY --from=wasm /build/fadroma-namada/pkg/fadroma_namada_bg.wasm ./fadroma/packages/namada/pkg/fadroma_namada_bg.wasm

RUN pwd && ls -al
