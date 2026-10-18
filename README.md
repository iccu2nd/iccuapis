# Rezora APIS

Self-documenting REST API gateway. Drop a file under `src/api/<group>/`, restart, and it appears in `/docs` and `/api/routes`.

## Run

```bash
npm install
npm start
```

Default port: `4000` (`PORT` to change).

## Layout

```
server.js           entry — middleware, route loader, static UI
src/config.js       identity + links + telegram
src/monitor.js      request stats, blocklist, batched Mongo writes
src/cache.js        in-memory TTL cache (capped)
src/mongoClient.js  lazy Mongo connection
src/bot.js          optional Telegram admin bot
src/api/<group>/    one file per route
public/             static UI (no build step)
  common.js         shared menu, notif, contacts
  index.js          landing page
  app.js            docs playground
```

## Env

| Variable | Purpose |
|----------|---------|
| `PORT` | Listen port |
| `MONGODB_URI` | Persist stats / blocklist / notifs |
| `MONGODB_DB` | DB name (default `mydb`) |
| `TELEGRAM_BOT_TOKEN` | Enable admin bot |
| `TELEGRAM_OWNER_IDS` | Comma-separated chat IDs |
| `TRUST_PROXY_HOPS` | Express trust proxy hops |

Without Mongo, stats stay in memory only.
