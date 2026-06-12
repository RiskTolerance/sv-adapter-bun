import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  buildExample,
  DEMO_DIR,
  startServer,
  stopServer,
  type RunningServer,
} from './helpers';

let server: RunningServer;

beforeAll(async () => {
  buildExample(DEMO_DIR, { ADAPTER_NO_WEBSOCKETS: '1' });
  server = await startServer(DEMO_DIR);
});

afterAll(async () => {
  await stopServer(server);
});

describe('demo app with websockets: false', () => {
  test('serves the prerendered homepage without the patch', async () => {
    const res = await fetch(`${server.baseUrl}/`);
    expect(res.status).toBe(200);
  });

  test('server-renders a component route at runtime', async () => {
    const res = await fetch(`${server.baseUrl}/sverdle`);
    expect(res.status).toBe(200);
  });

  test('runtime imports the stub instead of the hooks module', async () => {
    expect(
      await Bun.file(`${DEMO_DIR}/build/server/no-websocket-hooks.js`).exists()
    ).toBe(true);
    const handler = await Bun.file(`${DEMO_DIR}/build/handler.js`).text();
    expect(handler).toContain('./server/no-websocket-hooks.js');
  });
});
