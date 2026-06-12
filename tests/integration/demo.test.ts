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

  test('returns 304 for a matching etag', async () => {
    const html = await (await fetch(`${plain.baseUrl}/`)).text();
    const asset = html.match(/\/_app\/immutable\/[^"' )]+\.js/)?.[0];
    const first = await fetch(`${plain.baseUrl}${asset}`);
    const etag = first.headers.get('etag');
    expect(etag).toBeTruthy();

    const second = await fetch(`${plain.baseUrl}${asset}`, {
      headers: { 'if-none-match': etag! },
    });
    expect(second.status).toBe(304);
  });

  test('serves zstd-precompressed assets to clients that accept zstd', async () => {
    // pick an asset large enough that the build emitted a .zst variant
    // (tiny files are skipped because compression would inflate them)
    const { readdirSync } = await import('node:fs');
    const chunks_dir = `${DEMO_DIR}/build/client/_app/immutable/chunks`;
    const zst = readdirSync(chunks_dir).find(f => f.endsWith('.js.zst'));
    expect(zst).toBeTruthy();
    const asset = `/_app/immutable/chunks/${zst!.slice(0, -4)}`;

    const identity = await (
      await fetch(`${plain.baseUrl}${asset}`, {
        headers: { 'accept-encoding': 'identity' },
      })
    ).arrayBuffer();

    const res = await fetch(`${plain.baseUrl}${asset}`, {
      headers: { 'accept-encoding': 'zstd' },
      decompress: false,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-encoding')).toBe('zstd');
    expect(res.headers.get('vary')).toBe('Accept-Encoding');

    const decoded = Bun.zstdDecompressSync(
      new Uint8Array(await res.arrayBuffer())
    );
    expect(Buffer.from(decoded).equals(Buffer.from(identity))).toBe(true);
  });

  test('serves range requests with 206 and clean cached headers', async () => {
    const html = await (await fetch(`${plain.baseUrl}/`)).text();
    const asset = html.match(/\/_app\/immutable\/[^"' )]+\.js/)?.[0];

    const res = await fetch(`${plain.baseUrl}${asset}`, {
      headers: { range: 'bytes=0-9' },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toMatch(/^bytes 0-9\//);
    expect((await res.arrayBuffer()).byteLength).toBe(10);

    // a follow-up full request must not inherit range headers from the
    // shared cached Headers object
    const full = await fetch(`${plain.baseUrl}${asset}`);
    expect(full.status).toBe(200);
    expect(full.headers.get('content-range')).toBeNull();
  });

  test('server-renders a component route at runtime', async () => {
    // /sverdle is not prerendered — a 200 here proves runtime Svelte SSR
    // works in the bundled server (regression for the historical Bun.build
    // lifecycle_outside_component failure, upstream #82)
    const res = await fetch(`${plain.baseUrl}/sverdle`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<form');
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

describe('startup validation', () => {
  test('refuses to start with an out-of-range IDLE_TIMEOUT', () => {
    const result = Bun.spawnSync(['bun', 'build/index.js'], {
      cwd: DEMO_DIR,
      env: { ...process.env, IDLE_TIMEOUT: '300' },
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain('Invalid IDLE_TIMEOUT');
  });
});
