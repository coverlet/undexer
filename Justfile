default:
  just -l
up:
  docker compose up -d
  just logs
stop:
  docker compose stop
kill:
  docker compose kill
down:
  docker compose down -v
logs:
  docker compose logs -f --since=1m
ps:
  docker compose ps
psa:
  docker compose ps -a
prune-nm:
  find . -type d -name node_modules -exec sudo rm -rvf {} \;
sh-pnpmi:
  docker compose run --entrypoint /bin/sh pnpmi
api:
  docker compose up -d api
  docker compose logs -f api --since=1s
api-logs:
  docker compose logs -f api --since=1m
api-restart:
  docker compose kill api
  just api
indexer:
  docker compose up -d indexer
  docker compose logs -f indexer --since=1s
indexer-restart:
  docker compose kill indexer
  just indexer
psql:
  docker compose exec -u postgres postgres psql
cli:
  docker compose run api -c "./undexer repl"
repl:
  docker compose run api -c "./undexer repl"
push:
  git push -u github
  git push -u origin
tpush:
  git push --tags -u github
  git push --tags -u origin
fpush:
  git push -fu github
  git push -fu origin
