import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  buildExample,
  startServer,
  stopServer,
  WEBSOCKET_DIR,
  type RunningServer,
} from './helpers';

let server: RunningServer;
const bootEnv = { ADAPTER_BUN_TEST_SECRET: 'railway-secret' };

beforeAll(async () => {
  buildExample(WEBSOCKET_DIR);
  server = await startServer(WEBSOCKET_DIR, bootEnv);
});

afterAll(async () => {
  await stopServer(server);
});

describe('websocket app', () => {
  test('serves regular HTTP requests', async () => {
    const res = await fetch(`${server.baseUrl}/`);
    expect(res.status).toBe(200);
  });

  test('populates dynamic private env before hooks module evaluation', async () => {
    const res = await fetch(`${server.baseUrl}/env-at-hooks-boot`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(bootEnv.ADAPTER_BUN_TEST_SECRET);
  });

  test('upgrades, greets and echoes over /ws', async () => {
    const ws = new WebSocket(`${server.baseUrl.replace('http', 'ws')}/ws`);
    const messages: string[] = [];

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('timed out waiting for websocket messages')),
        10_000
      );
      ws.onmessage = event => {
        messages.push(String(event.data));
        if (messages.length === 1) ws.send('echo-test');
        if (messages.length === 2) {
          clearTimeout(timer);
          resolve();
        }
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error('websocket errored'));
      };
    });
    ws.close();

    expect(messages[0]).toBe('Slava Ukraїni');
    expect(messages[1]).toBe('echo-test');
  });

  test('hooks module instance is shared between kit and the websocket handlers', async () => {
    // the handle hook (imported by kit's server) increments module state on
    // upgrade; the websocket message handler (imported by the adapter via
    // the hooks entrypoint) reads it — a count of zero would mean the
    // bundler emitted two copies of the hooks module
    const ws = new WebSocket(`${server.baseUrl.replace('http', 'ws')}/ws`);
    const count = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('timed out waiting for upgrade-count')),
        10_000
      );
      ws.onmessage = e => {
        const text = String(e.data);
        if (text === 'Slava Ukraїni') return ws.send('upgrade-count');
        if (text.startsWith('upgrade-count:')) {
          clearTimeout(timer);
          resolve(Number(text.slice('upgrade-count:'.length)));
        }
      };
      ws.onerror = () => reject(new Error('websocket errored'));
    });
    ws.close();

    expect(count).toBeGreaterThanOrEqual(1);
  });

  // upstream gornostay25/svelte-adapter-bun#66 claimed pub/sub was impossible
  // through the adapter — these prove both publish paths work
  test('ws.publish broadcasts to other subscribers', async () => {
    const url = `${server.baseUrl.replace('http', 'ws')}/ws`;
    const [a, b] = [new WebSocket(url), new WebSocket(url)];
    const received: string[] = [];

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timed out; b received: ${received}`)),
        10_000
      );
      let greeted = 0;

      const greet = () => {
        // both sockets greeted means both are open and subscribed
        if (++greeted === 2) a.send('broadcast:from-a');
      };
      a.onmessage = e => {
        if (String(e.data) === 'Slava Ukraїni') greet();
      };
      b.onmessage = e => {
        const text = String(e.data);
        if (text === 'Slava Ukraїni') return greet();
        received.push(text);
        clearTimeout(timer);
        resolve();
      };
      a.onerror = b.onerror = () => reject(new Error('websocket errored'));
    });
    a.close();
    b.close();

    expect(received).toEqual(['from-a']);
  });

  test('server.publish from a request handler reaches subscribers', async () => {
    const ws = new WebSocket(`${server.baseUrl.replace('http', 'ws')}/ws`);
    const received: string[] = [];

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timed out; received: ${received}`)),
        10_000
      );
      ws.onmessage = async e => {
        const text = String(e.data);
        if (text === 'Slava Ukraїni') {
          // socket is open and subscribed — publish via the HTTP endpoint,
          // which uses event.platform.server.publish
          const res = await fetch(`${server.baseUrl}/broadcast`, {
            method: 'POST',
            body: 'from-http',
          });
          expect(res.status).toBe(200);
          return;
        }
        received.push(text);
        clearTimeout(timer);
        resolve();
      };
      ws.onerror = () => reject(new Error('websocket errored'));
    });
    ws.close();

    expect(received).toEqual(['from-http']);
  });
});
