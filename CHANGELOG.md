# Changelog

## 1.8.0 — 2026-06-18

### Changed

- **Rolldown is now the default server bundler**. `adapter()` tries rolldown
  first and falls back to `Bun.build` with a warning if rolldown fails. Set
  `adapter({ bundler: 'bun' })` to try `Bun.build` first; that path now also
  falls back to rolldown with a warning if Bun fails. If both bundlers fail,
  the build reports both errors together.

## 1.7.0 — 2026-06-15

### Changed

- **Default `'bun'` bundler falls back to rolldown on a chunk naming
  conflict**: some dependency graphs (e.g. apps using `better-auth`) make
  `Bun.build` fail with _"Multiple files share the same output path"_. When
  that happens and rolldown is installed, the adapter now retries the bundle
  with rolldown automatically and logs a one-line warning, instead of failing
  the build. README now recommends `bundler: 'rolldown'` for non-trivial
  apps.

### Internal

- The zstd serving integration test no longer depends on the ambient Node
  version of the build runtime (it asserts serving only when the build
  emitted `.zst` variants; see [#21](https://github.com/RiskTolerance/sv-adapter-bun/issues/21)).

## 1.6.0 — 2026-06-12

### Changed

- **WebSocket support no longer rewrites SvelteKit's built server**
  ([#10](https://github.com/RiskTolerance/sv-adapter-bun/issues/10)): the
  app's `hooks.server` module is now bundled as its own entrypoint and the
  runtime reads its `websocket` export directly — code splitting dedupes the
  module into a shared chunk, so kit's own import sees the same instance.
  This deletes the four regex patches that rewrote kit internals (and broke
  on kit 2.57's chunk layout, and on every bundler formatting change).
  The only remaining coupling is the stable `entries/hooks.server.js` output
  path, guarded by a loud build error. No user-facing API change.

## 1.5.1 — 2026-06-12

### Fixed

- **RFC 7233 range parsing** (also reported upstream as
  [#65](https://github.com/gornostay25/svelte-adapter-bun/issues/65)):
  suffix ranges (`bytes=-5`) returned the _first_ six bytes instead of the
  last five; `bytes=0-0` returned the whole file; reversed bounds
  (`bytes=8-3`) and non-bytes units (`items=0-5`) produced malformed 206
  responses. Invalid specs now serve a full 200 per RFC, unsatisfiable
  ranges get a proper 416 with `Content-Range: bytes */size`, and suffix /
  open-ended / clamped ranges behave to spec.

## 1.5.0 — 2026-06-12

### Verified

- **WebSocket pub/sub works through the adapter** (upstream
  [#66](https://github.com/gornostay25/svelte-adapter-bun/issues/66) is moot
  on the current architecture): `ws.subscribe`/`ws.publish` in the websocket
  hooks, and `event.platform.server.publish(...)` from any route or hook —
  the full Bun server instance is on `platform`. README documents the
  pattern; the websocket example and integration tests exercise both paths.
- **Streamed load promises stream** (upstream
  [#44](https://github.com/gornostay25/svelte-adapter-bun/issues/44)): the
  page shell flushes before slow promises settle; a demo route and a chunk
  timing test keep it that way.

### Added

- **zstd precompression and serving** (upstream
  [#84](https://github.com/gornostay25/svelte-adapter-bun/issues/84)):
  `precompress: true` now also emits `.zst` variants (level 19, same file
  selection as kit's gzip/brotli pass, skipped when compression would
  inflate) and the static server negotiates `Accept-Encoding: zstd` —
  preference order brotli > zstd > gzip. Building needs Bun or Node >= 22.15
  for the zstd pass; otherwise it is skipped with a warning.

## 1.4.0 — 2026-06-12

### Added

- **`websockets` adapter option** (default `true`): set `false` for apps
  without WebSockets to skip patching kit's built server entirely — no
  exposure to kit-internals drift, plain HTTP serving.

### Fixed

- **WebSocket patch works when the bundler splits `get_hooks()` into a
  chunk** (seen with SvelteKit 2.57+): the patch previously only searched
  `index.js`, but chunking is decided per-app by the bundler, so builds
  failed with "could not declare the websocket binding inside get_hooks()".
  All emitted server files (`index.js` + `chunks/*.js`) are now searched and
  a pattern only fails the build when it matches no file. Examples are
  pinned to kit 2.65 so default CI exercises current kit.

- **Range requests no longer serve byte slices of precompressed variants**:
  a `Range` request from a client that also sent `Accept-Encoding: br/gzip`
  received a slice of the `.br`/`.gz` file with `Content-Encoding` set — an
  undecodable response. Range requests now always get the identity encoding.

### Changed

- Static handler chain does less per-request work: the URL is parsed once
  per request and shared down the chain, and per-file headers (including
  `setHeaders` results and `Vary`) are computed once at startup instead of
  cloned and recomputed per hit. No measurable throughput change on the
  demo app — see issue #14 — but strictly less allocation per request.

## 1.3.0 — 2026-06-11

### Added

- **`bundler` adapter option**: choose between `'bun'` (default, `Bun.build`)
  and `'rolldown'` (now stable 1.x, declared as an optional peer dependency)
  for the server bundling step. Rolldown runs in-process under Node, avoiding
  the Bun subprocess that plain `vite build` otherwise needs. Benchmarks on
  the demo app (`bun run scripts/bench-bundlers.ts`): Bun.build ~13 ms
  in-process / ~44 ms via subprocess, rolldown ~27 ms in-process with ~9%
  smaller output — both negligible next to the vite build itself.

## 1.2.0 — 2026-06-11

> [!IMPORTANT]
> Building now requires Bun >= 1.3.6 (the deployed server already required a
> recent Bun). Plain `vite build` under Node still works as long as the `bun`
> executable is on `PATH`.

### Added

- **`idleTimeout` adapter option**
  ([#2](https://github.com/RiskTolerance/sv-adapter-bun/issues/2)): build-time
  default for Bun.serve's idle timeout, overridable at runtime with the
  `IDLE_TIMEOUT` env var. Both are validated as integers in 0–255 (Bun's cap;
  0 disables the timeout) with clear errors instead of opaque Bun failures.

### Changed

- **Server bundling switched from rolldown to `Bun.build`**
  ([#6](https://github.com/RiskTolerance/sv-adapter-bun/issues/6)): removes
  the adapter's only runtime dependency (a rolldown beta). Building now
  requires Bun >= 1.3.6; plain `vite build` under Node still works — the
  adapter spawns a `bun` subprocess for the bundling step. Code splitting is
  enabled, which also fixes a latent crash when serving builds compiled with
  `NODE_ENV` set to a non-production value (Svelte's dev SSR runtime broke
  under Bun.build's lazy module initializers without splitting).
- **WebSocket patch now fails the build loudly when SvelteKit's internals
  change shape** ([#3](https://github.com/RiskTolerance/sv-adapter-bun/issues/3)):
  the regex patch of kit's built server previously no-op'd silently when a
  pattern stopped matching, shipping a server whose WebSocket support had
  vanished. Each patch step is now verified and a clear build error points
  here when kit drifts. Apps without a `hooks.server` file are recognized and
  build as plain HTTP servers, as before.

## 1.1.0 — 2026-06-11

First release of the maintained fork, published as
`@risk-tolerance/svelte-adapter-bun`. Version numbering continues from
upstream [gornostay25/svelte-adapter-bun](https://github.com/gornostay25/svelte-adapter-bun) v1.0.1.

### Security

- **Forwarded header validation** (upstream
  [#83](https://github.com/gornostay25/svelte-adapter-bun/issues/83)):
  requests with malformed `PROTOCOL_HEADER`, `HOST_HEADER` or `PORT_HEADER`
  values are now rejected instead of producing an attacker-controlled
  origin. Ports the adapter-node hardening from
  [sveltejs/kit@d9ae9b0](https://github.com/sveltejs/kit/commit/d9ae9b00b14f5574d109f3fd548f960594346226).
  The protocol must be a valid URI scheme, the host must be present, and the
  port must be numeric. Note: duplicate (comma-joined) forwarded host headers
  are rejected outright — slightly stricter than adapter-node, which silently
  builds a garbage origin from them. If your proxy sends duplicate
  `x-forwarded-*` headers, deduplicate them at the proxy.

### Fixed

- **Build warnings for unprefixed built-ins** (upstream
  [#80](https://github.com/gornostay25/svelte-adapter-bun/issues/80),
  adapted from upstream PR
  [#85](https://github.com/gornostay25/svelte-adapter-bun/pull/85) by
  [@efpatti](https://github.com/efpatti)): server code importing Node
  built-ins without the `node:` prefix (`fs`, `crypto`, ...) or `bun:*`
  modules no longer produces `[UNRESOLVED_IMPORT]` warnings. The consumer's
  `peerDependencies` and `optionalDependencies` are now externalized too.
- **`BODY_SIZE_LIMIT` parsing**: `100B`-style values with an explicit byte
  suffix were rejected at startup despite being documented; a bare unit
  suffix (`K`) silently set the limit to zero instead of failing startup
  validation.
- Type errors against current `@types/bun` (generic `Bun.Server`, stricter
  `Bun.serve` option union).

### Added

- Unit test suite (`bun test tests/unit`) and integration smoke tests that
  build and run the example apps (`bun test tests/integration`), including
  an end-to-end regression test for the forwarded-header validation and a
  WebSocket upgrade/echo test.
- GitHub Actions CI: lint + tests on Bun latest/canary, plus a weekly
  fresh-lockfile run against the newest SvelteKit/Vite/rolldown releases.
- README documentation for the existing `BODY_SIZE_LIMIT`, `IDLE_TIMEOUT`
  and `PORT_HEADER` environment variables.

### Changed

- Package renamed to `@risk-tolerance/svelte-adapter-bun`; repository moved
  to [RiskTolerance/sv-adapter-bun](https://github.com/RiskTolerance/sv-adapter-bun).
- Examples consume the adapter via bun's `link:` protocol instead of
  `file:../../` (Bun copies `file:` folder dependencies wholesale, which was
  slow, stale and eventually hung installs).
