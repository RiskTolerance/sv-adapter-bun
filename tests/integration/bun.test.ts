import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  buildExample,
  DEMO_DIR,
  startServer,
  stopServer,
  WEBSOCKET_DIR,
  type RunningServer,
} from './helpers';

let demo: RunningServer;
let websocket: RunningServer;

beforeAll(async () => {
  buildExample(DEMO_DIR, { ADAPTER_BUNDLER: 'bun' });
  demo = await startServer(DEMO_DIR);

  buildExample(WEBSOCKET_DIR, { ADAPTER_BUNDLER: 'bun' });
  websocket = await startServer(WEBSOCKET_DIR);
});

afterAll(async () => {
  await Promise.all([stopServer(demo), stopServer(websocket)]);
});

describe('apps bundled with Bun.build', () => {
  test('server-renders a component route', async () => {
    const res = await fetch(`${demo.baseUrl}/sverdle`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<form');
  });

  test('preserves unprefixed Node built-in imports', async () => {
    const res = await fetch(`${demo.baseUrl}/hash`);
    expect(res.status).toBe(200);
  });

  test('preserves WebSocket hooks as a shared module', async () => {
    const ws = new WebSocket(`${websocket.baseUrl.replace('http', 'ws')}/ws`);
    const count = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('timed out waiting for upgrade-count')),
        10_000
      );
      ws.onmessage = event => {
        const text = String(event.data);
        if (text === 'Slava Ukraїni') return ws.send('upgrade-count');
        if (text.startsWith('upgrade-count:')) {
          clearTimeout(timer);
          resolve(Number(text.slice('upgrade-count:'.length)));
        }
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error('websocket errored'));
      };
    });
    ws.close();

    expect(count).toBeGreaterThanOrEqual(1);
  });
});
