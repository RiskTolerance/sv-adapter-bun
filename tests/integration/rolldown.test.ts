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
  buildExample(DEMO_DIR, { ADAPTER_BUNDLER: 'rolldown' });
  server = await startServer(DEMO_DIR);
});

afterAll(async () => {
  await stopServer(server);
});

describe('demo app bundled with rolldown', () => {
  test('serves the prerendered homepage', async () => {
    const res = await fetch(`${server.baseUrl}/`);
    expect(res.status).toBe(200);
  });

  test('server-renders a component route at runtime', async () => {
    const res = await fetch(`${server.baseUrl}/sverdle`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<form');
  });

  test('serves an endpoint that imports an unprefixed Node built-in', async () => {
    const res = await fetch(`${server.baseUrl}/hash`);
    expect(res.status).toBe(200);
  });
});
