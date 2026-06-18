# @risk-tolerance/svelte-adapter-bun

[![CI](https://github.com/RiskTolerance/sv-adapter-bun/actions/workflows/ci.yml/badge.svg)](https://github.com/RiskTolerance/sv-adapter-bun/actions/workflows/ci.yml)

[Adapter](https://svelte.dev/docs/kit/adapters) for SvelteKit apps that generates a standalone [Bun](https://github.com/oven-sh/bun) server.

> [!NOTE]
> This is a maintained fork of [gornostay25/svelte-adapter-bun](https://github.com/gornostay25/svelte-adapter-bun), which has been inactive since October 2025. This fork tracks upstream issues, ships security and compatibility fixes, and is tested in CI against current Bun and SvelteKit releases. Issues and PRs are welcome at [RiskTolerance/sv-adapter-bun](https://github.com/RiskTolerance/sv-adapter-bun).

## :zap: Usage

> [!NOTE]
> The generated server runs on Bun. The build step uses rolldown by default and falls back to `Bun.build` with a warning if rolldown fails. If fallback is needed while plain `vite build` is running under Node, the `bun` executable must be on `PATH`.

Install with `bun add -d @risk-tolerance/svelte-adapter-bun`, then add the adapter to your `svelte.config.js`:

```js
// svelte.config.js
import adapter from '@risk-tolerance/svelte-adapter-bun';

export default {
  kit: {
    adapter: adapter(),
  },
};
```

After building the server (`vite build`), use the following command to start:

```
# go to build directory
cd build/

# run Bun
bun run ./index.js
```

## :gear: Options

The adapter can be configured with various options:

```js
// svelte.config.js
import adapter from '@risk-tolerance/svelte-adapter-bun';
export default {
  kit: {
    adapter: adapter({
      out: 'build',
      serveAssets: true,
      envPrefix: 'MY_CUSTOM_',
      precompress: true,
      idleTimeout: 30,
      bundler: 'rolldown',
      websockets: true,
    }),
  },
};
```

### out

The directory to build the server to. It defaults to `build` — i.e. `bun run ./index.js` would start the server locally after it has been created.

### serveAssets

Serve static assets. Default: `true`

- [x] Support [HTTP range requests](https://developer.mozilla.org/en-US/docs/Web/HTTP/Range_requests)

### precompress

Enables precompressing using gzip, brotli and zstd for assets and prerendered pages. It defaults to `true`. The server negotiates per-request via `Accept-Encoding` (brotli preferred, then zstd, then gzip); variants that would be larger than the original are not emitted. zstd requires Bun or Node >= 22.15 at build time — older Node skips the zstd pass with a warning.

### idleTimeout

Default idle timeout for the server in seconds — see the [`IDLE_TIMEOUT`](#idle_timeout) environment variable, which overrides this at runtime. `0` disables the timeout; Bun caps the value at `255`.

### bundler

Which bundler gets the first attempt at producing the server bundle. Default: `'rolldown'`.

[rolldown](https://rolldown.rs) runs in-process under Node or Bun (no Bun subprocess when building with plain `vite build`), and it chunks some dependency graphs that `Bun.build` cannot yet (e.g. apps using `better-auth`, where `Bun.build` fails with _"Multiple files share the same output path"_).

Set `'bun'` to try `Bun.build` first:

```js
adapter({ bundler: 'bun' });
```

Whichever bundler runs first, the adapter automatically falls back to the other bundler on failure and logs a warning naming the failed primary. If both fail, the build fails with an aggregate error containing both failures. Benchmarks on the demo app show both bundlers well under 50 ms, so pick by robustness and environment rather than speed.

### websockets

Whether to bundle the app's `hooks.server` module so the server can use its [`websocket` export](#spider_web-websocket-server). Default: `true`. Set `false` for apps that don't use WebSockets — the server then runs plain HTTP.

### envPrefix

If you need to change the name of the environment variables used to configure the deployment (for example, to deconflict with environment variables you don't control), you can specify a prefix:

```js
envPrefix: 'MY_CUSTOM_';
```

```
MY_CUSTOM_HOST=127.0.0.1 \
MY_CUSTOM_PORT=4000 \
MY_CUSTOM_ORIGIN=https://my.site \
bun build/index.js
```

## :spider_web: WebSocket Server

https://bun.sh/docs/runtime/http/websockets

The server supports WebSocket connections. To enable them, you need to add a `websocket` hook to server hooks.

```ts
// hooks.server.ts
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
  const { request } = event;
  const url = new URL(request.url);

  // Check for WebSocket upgrade request
  if (
    request.headers.get('connection')?.toLowerCase().includes('upgrade') &&
    request.headers.get('upgrade')?.toLowerCase() === 'websocket' &&
    url.pathname.startsWith('/ws')
  ) {
    await event.platform.server.upgrade(event.platform.request);
    return new Response(null, { status: 101 });
  }

  return resolve(event);
};

export const websocket: Bun.WebSocketHandler<undefined> = {
  async open(ws) {
    console.log('WebSocket opened');
    ws.send('Slava Ukraїni');
  },
  message(ws, message) {
    console.log('WebSocket message received');
    ws.send(message);
  },
  close(ws) {
    console.log('WebSocket closed');
  },
};
```

[Bun's pub/sub](https://bun.sh/docs/runtime/http/websockets#pub-sub) works through the adapter: subscribe sockets in the `websocket` handlers (`ws.subscribe('room')`, broadcast with `ws.publish`), and publish from any server route or hook through the Bun server instance on `event.platform`:

```ts
// src/routes/broadcast/+server.ts
export const POST = async ({ request, platform }) => {
  platform.server.publish('room', await request.text());
  return new Response('ok');
};
```

For detailed documentation, examples, and advanced usage patterns, visit the [WebSocket example README](examples/websocket/README.md).

## :desktop_computer: Environment variables

> Bun automatically reads configuration from `.env`, the mode-specific file matching `NODE_ENV` (`.env.production`, `.env.development`, or `.env.test`), and `.env.local`.

### `PORT` and `HOST`

By default, the server will accept connections on `0.0.0.0` using port 3000. These can be customized with the `PORT` and `HOST` environment variables:

```
HOST=127.0.0.1 PORT=4000 bun build/index.js
```

### `SOCKET_PATH`

Instead of using TCP/IP connections, you can configure the server to listen on a Unix domain socket by setting the `SOCKET_PATH` environment variable:

```
SOCKET_PATH=/tmp/sveltekit.sock bun build/index.js
```

When `SOCKET_PATH` is set, the server will ignore the `HOST` and `PORT` settings and use the Unix socket instead. This is useful for deployment behind reverse proxies like nginx.

### `ORIGIN`, `PROTOCOL_HEADER` and `HOST_HEADER`

HTTP doesn't give SvelteKit a reliable way to know the URL that is currently being requested. The simplest way to tell SvelteKit where the app is being served is to set the `ORIGIN` environment variable:

```
ORIGIN=https://my.site bun build/index.js
```

With this, a request for the `/stuff` pathname will correctly resolve to `https://my.site/stuff`. Alternatively, you can specify headers that tell SvelteKit about the request protocol and host, from which it can construct the origin URL:

```
PROTOCOL_HEADER=x-forwarded-proto HOST_HEADER=x-forwarded-host bun build/index.js
```

> [`x-forwarded-proto`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Forwarded-Proto) and [`x-forwarded-host`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Forwarded-Host) are de facto standard headers that forward the original protocol and host if you're using a reverse proxy (think load balancers and CDNs). You should only set these variables if your server is behind a trusted reverse proxy; otherwise, it'd be possible for clients to spoof these headers.

You can also specify a `PORT_HEADER` if your proxy forwards a non-standard port.

> [!IMPORTANT]
> Since v1.1.0, requests carrying malformed values in the headers named by `PROTOCOL_HEADER`, `HOST_HEADER` or `PORT_HEADER` (for example a protocol containing `:`, duplicate comma-joined values, or a non-numeric port) are rejected instead of being used to silently construct an attacker-controlled origin. This ports the same hardening that SvelteKit applied to `adapter-node`.

### `ADDRESS_HEADER` and `XFF_DEPTH`

The [RequestEvent](https://svelte.dev/docs/kit/%40sveltejs-kit#RequestEvent) object passed to hooks and endpoints includes an `event.getClientAddress()` function. By default, the adapter reads the client address from Bun's `server.requestIP(request)`. If your server is behind one or more proxies (such as a load balancer), specify `ADDRESS_HEADER` to read the address from a trusted proxy header instead:

```
ADDRESS_HEADER=True-Client-IP bun build/index.js
```

> Headers can easily be spoofed. As with `PROTOCOL_HEADER` and `HOST_HEADER`, you should [know what you're doing](https://adam-p.ca/blog/2022/03/x-forwarded-for/) before setting these.
> If the `ADDRESS_HEADER` is `X-Forwarded-For`, the header value will contain a comma-separated list of IP addresses. The `XFF_DEPTH` environment variable should specify how many trusted proxies sit in front of your server. E.g. if there are three trusted proxies, proxy 3 will forward the addresses of the original connection and the first two proxies:

```
<client address>, <proxy 1 address>, <proxy 2 address>
```

Some guides will tell you to read the left-most address, but this leaves you [vulnerable to spoofing](https://adam-p.ca/blog/2022/03/x-forwarded-for/):

```
<spoofed address>, <client address>, <proxy 1 address>, <proxy 2 address>
```

Instead, we read from the _right_, accounting for the number of trusted proxies. In this case, we would use `XFF_DEPTH=3`.

> If you need to read the left-most address instead (and don't care about spoofing) — for example, to offer a geolocation service, where it's more important for the IP address to be _real_ than _trusted_, you can do so by inspecting the `x-forwarded-for` header within your app.

### `BODY_SIZE_LIMIT`

The maximum request body size in bytes, with optional `K`, `M` or `G` unit suffixes (kilobytes, megabytes, gigabytes). Defaults to `512K`. Set it to `Infinity` to disable the limit:

```
BODY_SIZE_LIMIT=10M bun build/index.js
```

### `IDLE_TIMEOUT`

The maximum number of seconds a connection may sit idle before Bun closes it. Defaults to the `idleTimeout` adapter option, or `10` — meaning responses that take longer than 10 seconds to produce will be aborted. Increase it for long-running requests or streams, or set `0` to disable the timeout entirely. Bun caps the value at `255`; anything outside `0`–`255` fails startup with an error:

```
IDLE_TIMEOUT=120 bun build/index.js
```

## License

[MIT](LICENSE) © [Volodymyr Palamar](https://github.com/gornostay25)

Fork maintained by [RiskTolerance](https://github.com/RiskTolerance).
