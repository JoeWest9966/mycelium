# mycelium

The panel for [hypha](https://github.com/JoeWest9966/hypha) — a separate
repository, a separate deploy, a separate release cadence.

```
browser ──► nginx ──┬─► mycelium (this repo, static build)
                    └─► hyphad   (the hub: /api, /agent, /install.sh, /dl)
```

The two halves meet at exactly one place: **`hypha/api/openapi.yaml`**.

## Why a separate repository

Because the panel needed a build step and the hub's repository couldn't give it
one. That sounds like taste, but it has a concrete cost: a hand-written DOM app
with no types lives comfortably in `crates/hub/static/`, right up until it has to
render a live exec stream, a terminal, an install-key manager and a warehouse
picker. Then it doesn't.

Splitting also settles the API surface while it is still small enough to settle.
Fourteen paths is cheap to describe; forty is a negotiation.

## The contract, and why it is the whole design

`src/api/schema.d.ts` is **generated** from the hub's OpenAPI file:

```sh
npm run api:types     # openapi-typescript ../hypha/api/openapi.yaml
npm run api:check     # fails when the committed types drift from the spec
```

Nothing here hand-writes a response shape. `src/api/types.ts` re-exports from the
generated schema, so a renamed field becomes a compile error instead of
`undefined` rendered on screen.

Two hazards the types cannot catch, both encoded in `src/api/client.ts`:

- **`ExecOutput.data` is base64 of raw bytes.** Casting it to a string corrupts
  everything that is not ASCII. `b64Text()` decodes via `Uint8Array` and a
  streaming `TextDecoder`, because a multi-byte character can straddle two SSE
  chunks.
- **The stream has no replay cursor.** The hub streams a finished exec from
  cursor 0 again on any new connection, so letting `EventSource` auto-reconnect
  after `done` re-delivers the entire run. `streamExec()` closes on `done` and on
  any error, for that reason.

The panel refuses to boot when the hub reports an `api_version` it does not know:

```
mycelium can't talk to this hub
hub speaks API v2, this panel was built for v1. Upgrade the panel.
```

## Develop

The hub runs elsewhere; Vite proxies `/api` to it so there is no CORS.

```sh
npm install
npm run dev                        # :5523, proxies to 127.0.0.1:5522
HYPHA_HUB=http://100.126.95.105:5522 npm run dev
```

Run a hub locally from the hypha checkout:

```sh
cargo run -p hypha-hub -- --config hub.json
```

## Build and deploy

```sh
npm run build                      # typecheck + vite build -> dist/
```

nginx serves `dist/` and proxies the rest — see `hypha/dist/nginx-hypha.conf`.
The short version:

| path | goes to |
|---|---|
| `/` | this build, `try_files … /index.html` |
| `/api/` | hyphad, **`proxy_buffering off`** and WebSocket upgrade |
| `/agent` | hyphad, WebSocket, 1h timeouts |
| `/install.sh`, `/dl/` | hyphad (installer endpoints, not panel routes) |

`index.html` must be `no-store` and hashed assets `immutable`, or a deploy
strands browsers on an old shell pointing at asset names that no longer exist.

Alternatively, point the hub's `static_dir` at `dist/` and skip nginx entirely.
hyphad serves a bundle from anywhere; it just doesn't own one.

## Scope

Working: hub handshake with version gate, fleet list with tags and load, fan-out
exec with live stdout/stderr, exit codes, 20-run history in memory.

Not yet: interactive shells (xterm.js over `/api/pty`), install-key management,
host removal, tags editing, the warehouse installer.

## License

MIT.
