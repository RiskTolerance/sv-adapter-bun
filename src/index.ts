/* global BUILD_OPTIONS */
import { env } from 'ENV';
import { getHandler } from 'HANDLER';
import process from 'node:process';
import { parse_as_bytes, parse_idle_timeout } from './internal/parse';

export const path = env('SOCKET_PATH', false);
export const host = env('HOST', '0.0.0.0');
export const port = env('PORT', '3000');

const body_size_limit = parse_as_bytes(env('BODY_SIZE_LIMIT', '512K'));
if (Number.isNaN(body_size_limit)) {
  throw new Error(
    `Invalid BODY_SIZE_LIMIT: '${env('BODY_SIZE_LIMIT')}'. Please provide a numeric value.`
  );
}

// precedence: IDLE_TIMEOUT env var > idleTimeout adapter option > Bun default
const idle_timeout = parse_idle_timeout(
  env('IDLE_TIMEOUT', String(BUILD_OPTIONS.idleTimeout ?? 10))
);
if (Number.isNaN(idle_timeout)) {
  throw new Error(
    `Invalid IDLE_TIMEOUT: '${env('IDLE_TIMEOUT', String(BUILD_OPTIONS.idleTimeout))}'. Please provide an integer between 0 (disabled) and 255 seconds.`
  );
}

const { fetch: handlerFetch, websocket } = getHandler();

const base_options = {
  maxRequestBodySize: body_size_limit,
  fetch: handlerFetch,
};
const tcp_options = {
  hostname: host,
  port: port,
  // Bun's types forbid idleTimeout on unix sockets (the runtime ignores it)
  idleTimeout: idle_timeout,
};

// explicit branches because Bun.serve's option union rejects
// optionally-undefined websocket and unix keys
const server = websocket
  ? path
    ? Bun.serve({ ...base_options, websocket, unix: path })
    : Bun.serve({ ...base_options, websocket, ...tcp_options })
  : path
    ? Bun.serve({ ...base_options, unix: path })
    : Bun.serve({ ...base_options, ...tcp_options });

console.log(`Listening on ${server.url} ${websocket ? 'with WebSocket' : ''}`);

async function graceful_shutdown(reason: 'SIGINT' | 'SIGTERM' | 'IDLE') {
  console.info('Stopping server...');
  process.emit('sveltekit:shutdown', reason);
  await server.stop(true);
  console.info('Stopped server');

  process.removeListener('SIGINT', graceful_shutdown);
  process.removeListener('SIGTERM', graceful_shutdown);
}

process.on('SIGTERM', graceful_shutdown);
process.on('SIGINT', graceful_shutdown);

export { server };
