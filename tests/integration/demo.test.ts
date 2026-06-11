import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  buildExample,
  DEMO_DIR,
  startServer,
  stopServer,
  type RunningServer,
} from './helpers';

let plain: RunningServer;
let proxied: RunningServer;

beforeAll(async () => {
  buildExample(DEMO_DIR);
  [plain, proxied] = await Promise.all([
    startServer(DEMO_DIR),
    startServer(DEMO_DIR, {
      PROTOCOL_HEADER: 'x-forwarded-proto',
      HOST_HEADER: 'x-forwarded-host',
      PORT_HEADER: 'x-forwarded-port',
    }),
  ]);
});

afterAll(async () => {
  await Promise.all([stopServer(plain), stopServer(proxied)]);
});

describe('demo app', () => {
  test('serves the SSR homepage', async () => {
    const res = await fetch(`${plain.baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  test('serves immutable client assets with long-lived cache headers', async () => {
    const html = await (await fetch(`${plain.baseUrl}/`)).text();
    const asset = html.match(/\/_app\/immutable\/[^"' )]+\.js/)?.[0];
    expect(asset).toBeDefined();

    const res = await fetch(`${plain.baseUrl}${asset}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe(
      'public,max-age=31536000,immutable'
    );
  });

  test('returns 404 for unknown paths', async () => {
    const res = await fetch(`${plain.baseUrl}/nonexistent-xyz`);
    expect(res.status).toBe(404);
  });

  test('serves an endpoint that imports an unprefixed Node built-in', async () => {
    const res = await fetch(`${plain.baseUrl}/hash`);
    expect(res.status).toBe(200);
    const { hash } = (await res.json()) as { hash: string };
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('forwarded header validation', () => {
  // /hash is server-rendered; prerendered paths like / are served statically
  // and never reach get_origin
  test('accepts clean forwarded headers', async () => {
    const res = await fetch(`${proxied.baseUrl}/hash`, {
      headers: {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'example.com',
      },
    });
    expect(res.status).toBe(200);
  });

  test('rejects a protocol header containing a URL', async () => {
    const res = await fetch(`${proxied.baseUrl}/hash`, {
      headers: {
        'x-forwarded-proto': 'https://evil.example',
        'x-forwarded-host': 'example.com',
      },
    });
    expect(res.status).toBe(500);
  });

  test('rejects comma-joined duplicate port headers', async () => {
    const res = await fetch(`${proxied.baseUrl}/hash`, {
      headers: {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'example.com',
        'x-forwarded-port': '80, 80',
      },
    });
    expect(res.status).toBe(500);
  });

  test('keeps serving after rejecting a malicious request', async () => {
    const res = await fetch(`${proxied.baseUrl}/hash`, {
      headers: {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'example.com',
      },
    });
    expect(res.status).toBe(200);
  });
});
