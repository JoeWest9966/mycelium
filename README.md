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
git clone https://github.com/JoeWest9966/hypha.git ../hypha
npm run api:types     # regenerate from ../hypha/api/openapi.yaml
npm run api:check     # fail when the committed types drift from the spec
```

`HYPHA_DIR=/path/to/hypha` if the checkout lives elsewhere. Building never needs
the spec — `src/api/schema.d.ts` is committed, so a clean clone builds offline.

Nothing here hand-writes a response shape. `src/api/types.ts` re-exports from the
generated schema, so a renamed field becomes a compile error instead of
`undefined` rendered on screen.

Three hazards the types cannot catch, all encoded in `src/api/client.ts`:

- **`ExecOutput.data` is base64 of raw bytes.** Casting it to a string corrupts
  everything that is not ASCII. `b64Text()` decodes via `Uint8Array` and a
  streaming `TextDecoder`, because a multi-byte character can straddle two SSE
  chunks.
- **The stream has no replay cursor.** The hub streams a finished exec from
  cursor 0 again on any new connection, so letting `EventSource` auto-reconnect
  after `done` re-delivers the entire run. `streamExec()` closes on `done` and on
  any error, for that reason.
- **The PTY direction flips the encoding.** `TermIn.input.data` is plain UTF-8
  keystrokes; `TermOut.output.data` is base64 of raw terminal bytes. Output goes
  into xterm as a byte array, never as a decoded string.
- **The clipboard API does not exist over plain http.** `navigator.clipboard` is
  gated on a secure context, and this panel runs on tailnet http. Every copy
  button goes through `src/lib/clipboard.ts`, which falls back to the
  `execCommand` path that still works there. Blaming the browser was a bug.
- **A shell is a session, not a socket.** `POST /api/pty` allocates it and
  `GET /api/pty?pty_id=` attaches. Closing the socket detaches; attaching again
  replays the scrollback. Treating the WebSocket as the shell would kill `vim`
  on every reload.

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

Two escape hatches when a web server is not available:

- point the hub's `static_dir` at `dist/` — hyphad serves a bundle from anywhere,
  it just doesn't own one. API and panel then share an origin.
- run `deploy/proxy.mjs` (zero dependencies, one process, route map identical to
  the nginx config) with `deploy/mycelium.service`. This is how the reference
  deployment runs today:

```sh
npm run build
PORT=5524 WAREHOUSE_URL=http://<warehouse>/p/<project>/<id>/api node deploy/proxy.mjs
```

## The warehouse catalog

`Warehouse` in the top nav lists machines from the Nous warehouse (which proxies
`nw-panel` and ultimately `/opt/Data-001/vps/vps.json`). It is a **second,
external contract** — schema `vq0f03/vps-ls.v1` — not part of hypha's OpenAPI
file, so its types live alone in `src/api/warehouse.ts` and every field is
treated as optional at the point of use.

The panel never hardcodes that deployment. It asks for one path:

```
GET /api/warehouse/vps
```

Whatever answers it wins. Dev:

```sh
WAREHOUSE_API=http://100.106.43.81:4790/p/new1/vq0f03/api npm run dev
```

Production, in the same server block that serves this build:

```nginx
location /api/warehouse/ {
    proxy_pass https://j1900.tail8d0018.ts.net:8443/;   # nw-panel
    proxy_set_header Host $host;
}
```

Keep this **above** `location /api/` or nginx hands the path to hyphad, which
has no such route. And point it at the API, not at the panel's HTML: a wrong
upstream usually answers `200 text/html`, which is why the client checks that
the body is JSON and says so when it is not.

### What this view deliberately does not do

It does not install anything. The catalog read API hands out **commands**, not
credentials — no password or key ever appears in the payload, and the machine
rows carry a ready-to-paste `ssh -p …` string instead. There is no button here
that pretends otherwise.

`in fleet` is inferred, not recorded: a warehouse machine counts as enrolled when
a hypha host reports the same hostname or carries the name as a tag. That guess
is wrong for a machine whose hostname differs from its catalog name; enrolling
with `wh:<name>` tags makes it exact.

## Scope

Working: hub handshake with version gate, fleet list with live cpu/mem/disk
meters and a details panel, fan-out exec with live stdout/stderr and a cancel
button, interactive shells that survive a reload (the hub keeps the session, a
reattach replays the scrollback), install-key management, host removal with a
two-click confirm, inline tag editing, atomic file push, the audit trail, and a
read-only warehouse catalog with copyable ssh commands.

Presence polls every 5s while the tab is visible, because a stale "online" is
worse than no status at all.

Not yet: one-click install from the warehouse (the catalog hands out commands,
not credentials — see hypha #271), scheduled jobs, per-host arguments.

## License

MIT.
