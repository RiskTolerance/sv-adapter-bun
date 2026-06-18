# @risk-tolerance/svelte-adapter-bun

[![CI](https://github.com/RiskTolerance/sv-adapter-bun/actions/workflows/ci.yml/badge.svg)](https://github.com/RiskTolerance/sv-adapter-bun/actions/workflows/ci.yml)

SvelteKit adapter that builds a standalone [Bun](https://bun.sh) server.

This is a maintained fork of [gornostay25/svelte-adapter-bun](https://github.com/gornostay25/svelte-adapter-bun), whose last upstream release was in October 2025. This fork tracks upstream issues, ships compatibility and security fixes, and is tested against current Bun and SvelteKit releases.

## Quick Start

Install the adapter:

```sh
bun add -d @risk-tolerance/svelte-adapter-bun
```

Use it in `svelte.config.js`:

```js
import adapter from '@risk-tolerance/svelte-adapter-bun';

export default {
  kit: {
    adapter: adapter(),
  },
};
```

Build and run:

```sh
bun run build
bun build/index.js
```

The generated server runs on Bun. The build step uses rolldown by default and falls back to `Bun.build` with a warning if rolldown fails. If that fallback runs during plain `vite build` under Node, the `bun` executable must be on `PATH`.

## Options

```js
adapter({
  out: 'build',
  serveAssets: true,
  precompress: true,
  envPrefix: '',
  idleTimeout: 30,
  bundler: 'rolldown',
  websockets: true,
});
```

| Option        | Default      | Description                                                                                            |
| ------------- | ------------ | ------------------------------------------------------------------------------------------------------ |
| `out`         | `'build'`    | Output directory for the generated server.                                                             |
| `serveAssets` | `true`       | Serve client and prerendered assets from Bun, including HTTP range requests.                           |
| `precompress` | `true`       | Emit gzip, brotli, and zstd variants for assets and prerendered pages.                                 |
| `envPrefix`   | `''`         | Prefix for runtime adapter env vars such as `PORT`, `ORIGIN`, and `BODY_SIZE_LIMIT`.                   |
| `idleTimeout` | `undefined`  | Build-time default for Bun's idle timeout. Runtime `IDLE_TIMEOUT` wins.                                |
| `bundler`     | `'rolldown'` | Primary server bundler: `'rolldown'` or `'bun'`. The other bundler is used as fallback.                |
| `websockets`  | `true`       | Bundle `hooks.server` so the adapter can read its `websocket` export. Set `false` for plain HTTP apps. |

## Bundling

Rolldown is the default because it is the more robust server bundler for current SvelteKit apps. It runs in-process under Node or Bun and handles dependency graphs that `Bun.build` can fail to chunk, such as apps using `better-auth`.

To try `Bun.build` first:

```js
adapter({ bundler: 'bun' });
```

Fallback works both directions. If the primary bundler fails, the adapter logs a warning naming the failed primary and retries with the other bundler. If both fail, the build fails with an aggregate error containing both failures.

## Static Assets

With `serveAssets: true`, the generated server serves:

- client assets from `build/client`
- prerendered pages from `build/prerendered`
- immutable SvelteKit assets with long-lived cache headers
- HTTP range requests with identity encoding

With `precompress: true`, the adapter emits gzip, brotli, and zstd variants when compression reduces size. The server negotiates `Accept-Encoding` per request, preferring brotli, then zstd, then gzip. zstd precompression requires Bun or Node 22.15+ at build time; older Node builds skip zstd with a warning.

## WebSockets

Bun WebSockets are supported through a `websocket` export from `src/hooks.server.ts`. The `handle` hook upgrades matching requests, and the adapter passes the exported handler to `Bun.serve`.

```ts
// src/hooks.server.ts
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
  const { request } = event;
  const url = new URL(request.url);

  if (
    request.headers.get('connection')?.toLowerCase().includes('upgrade') &&
    request.headers.get('upgrade')?.toLowerCase() === 'websocket' &&
    url.pathname === '/ws'
  ) {
    await event.platform!.server.upgrade(event.platform!.request);
    return new Response(null, { status: 101 });
  }

  return resolve(event);
};

export const websocket: Bun.WebSocketHandler<undefined> = {
  open(ws) {
    ws.send('connected');
  },
  message(ws, message) {
    ws.send(message);
  },
};
```

Add platform types if you use TypeScript:

```ts
// src/app.d.ts
declare global {
  namespace App {
    interface Platform {
      server: Bun.Server;
      request: Request;
    }
  }
}

export {};
```

Bun's pub/sub API works through the adapter. Subscribe sockets in the `websocket` handlers with `ws.subscribe('room')`, broadcast from a socket with `ws.publish(...)`, or publish from any route/hook through `event.platform.server.publish(...)`.

```ts
// src/routes/broadcast/+server.ts
export async function POST({ request, platform }) {
  platform!.server.publish('room', await request.text());
  return new Response('ok');
}
```

See Bun's [WebSocket docs](https://bun.sh/docs/runtime/http/websockets) and this repo's [WebSocket example](examples/websocket/README.md) for more detail.

## Runtime Configuration

Bun automatically reads `.env`, the mode-specific file matching `NODE_ENV` (`.env.production`, `.env.development`, or `.env.test`), and `.env.local`.

All adapter runtime variables can be prefixed with `envPrefix`. For example, `adapter({ envPrefix: 'MY_APP_' })` makes the server read `MY_APP_PORT`, `MY_APP_ORIGIN`, and so on.

### Server Binding

| Variable      | Default   | Description                                                |
| ------------- | --------- | ---------------------------------------------------------- |
| `HOST`        | `0.0.0.0` | TCP host.                                                  |
| `PORT`        | `3000`    | TCP port.                                                  |
| `SOCKET_PATH` | unset     | Unix socket path. When set, `HOST` and `PORT` are ignored. |

```sh
HOST=127.0.0.1 PORT=4000 bun build/index.js
SOCKET_PATH=/tmp/sveltekit.sock bun build/index.js
```

### Origin And Proxy Headers

Set `ORIGIN` when you know the public origin:

```sh
ORIGIN=https://example.com bun build/index.js
```

Or configure trusted reverse-proxy headers:

```sh
PROTOCOL_HEADER=x-forwarded-proto \
HOST_HEADER=x-forwarded-host \
PORT_HEADER=x-forwarded-port \
bun build/index.js
```

Only use forwarded headers behind a trusted proxy. Malformed values in `PROTOCOL_HEADER`, `HOST_HEADER`, or `PORT_HEADER` are rejected instead of being used to construct an origin.

### Client Addresses

SvelteKit exposes `event.getClientAddress()`. By default, this adapter reads from Bun's `server.requestIP(request)`.

Behind a trusted proxy, set `ADDRESS_HEADER`:

```sh
ADDRESS_HEADER=True-Client-IP bun build/index.js
```

For `X-Forwarded-For`, set `XFF_DEPTH` to the number of trusted proxies. The adapter reads from the right side of the header to avoid spoofed left-most values.

```sh
ADDRESS_HEADER=X-Forwarded-For XFF_DEPTH=2 bun build/index.js
```

If you need the left-most address for geolocation or similar use cases, inspect `x-forwarded-for` inside your app instead.

### Request Limits And Timeouts

| Variable          | Default                          | Description                                                                         |
| ----------------- | -------------------------------- | ----------------------------------------------------------------------------------- |
| `BODY_SIZE_LIMIT` | `512K`                           | Maximum request body size. Supports bare bytes, `B`, `K`, `M`, `G`, and `Infinity`. |
| `IDLE_TIMEOUT`    | adapter `idleTimeout`, then `10` | Bun idle timeout in seconds. `0` disables it; Bun caps it at `255`.                 |

```sh
BODY_SIZE_LIMIT=10M IDLE_TIMEOUT=120 bun build/index.js
```

Invalid values fail startup with a clear error.

## License

[MIT](LICENSE) © [Volodymyr Palamar](https://github.com/gornostay25)

Fork maintained by [RiskTolerance](https://github.com/RiskTolerance).
