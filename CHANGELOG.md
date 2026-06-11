# Changelog

## 1.1.0 — 2026-06-11

First release of the maintained fork, published as
`@risktolerance/svelte-adapter-bun`. Version numbering continues from
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

- Package renamed to `@risktolerance/svelte-adapter-bun`; repository moved
  to [RiskTolerance/sv-adapter-bun](https://github.com/RiskTolerance/sv-adapter-bun).
- Examples consume the adapter via bun's `link:` protocol instead of
  `file:../../` (Bun copies `file:` folder dependencies wholesale, which was
  slow, stale and eventually hung installs).
