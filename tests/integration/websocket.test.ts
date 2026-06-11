import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  buildExample,
  startServer,
  stopServer,
  WEBSOCKET_DIR,
  type RunningServer,
} from './helpers';

let server: RunningServer;

beforeAll(async () => {
  buildExample(WEBSOCKET_DIR);
  server = await startServer(WEBSOCKET_DIR);
});

afterAll(async () => {
  await stopServer(server);
});

describe('websocket app', () => {
  test('serves regular HTTP requests', async () => {
    const res = await fetch(`${server.baseUrl}/`);
    expect(res.status).toBe(200);
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
});
