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
    // zstd precompression needs a build runtime with zstd support (Bun, or
    // Node >= 22.15). `vite build` runs under whatever `node` its shebang
    // resolves to, so on an older Node no .zst variants are emitted. The
    // compressor itself is covered deterministically by the unit tests
    // (tests/unit/compress.test.ts, always under Bun); here we only assert
    // end-to-end serving when variants actually exist.
    const { readdirSync } = await import('node:fs');
    const chunks_dir = `${DEMO_DIR}/build/client/_app/immutable/chunks`;
    const zst = readdirSync(chunks_dir).find(f => f.endsWith('.js.zst'));
    if (!zst) {
      console.warn(
        'Skipping zstd serving assertions — the build runtime emitted no ' +
          '.zst variants (Node < 22.15 and not Bun). See issue #21.'
      );
      return;
    }
    const asset = `/_app/immutable/chunks/${zst.slice(0, -4)}`;

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

  test('handles RFC 7233 range edge cases', async () => {
    const html = await (await fetch(`${plain.baseUrl}/`)).text();
    const asset = html.match(/\/_app\/immutable\/[^"' )]+\.js/)?.[0];
    const url = `${plain.baseUrl}${asset}`;
    const size = (await (await fetch(url)).arrayBuffer()).byteLength;

    // suffix range = LAST five bytes (historically returned the first six)
    const suffix = await fetch(url, { headers: { range: 'bytes=-5' } });
    expect(suffix.status).toBe(206);
    expect(suffix.headers.get('content-range')).toBe(
      `bytes ${size - 5}-${size - 1}/${size}`
    );
    expect((await suffix.arrayBuffer()).byteLength).toBe(5);

    // reversed bounds: invalid spec, header ignored, full 200
    const reversed = await fetch(url, { headers: { range: 'bytes=8-3' } });
    expect(reversed.status).toBe(200);
    expect((await reversed.arrayBuffer()).byteLength).toBe(size);

    // non-bytes unit: ignored, full 200 (historically a mangled 206)
    const weird = await fetch(url, { headers: { range: 'items=0-5' } });
    expect(weird.status).toBe(200);

    // single byte (historically returned the whole file)
    const one = await fetch(url, { headers: { range: 'bytes=0-0' } });
    expect(one.status).toBe(206);
    expect((await one.arrayBuffer()).byteLength).toBe(1);

    // start past EOF: 416 with the star form
    const beyond = await fetch(url, {
      headers: { range: `bytes=${size}-` },
    });
    expect(beyond.status).toBe(416);
    expect(beyond.headers.get('content-range')).toBe(`bytes */${size}`);
  });

  // upstream gornostay25/svelte-adapter-bun#44 claimed streamed load
  // promises buffer until fully resolved — this proves the shell flushes
  // before the slow promise settles
  test('streams load promises instead of buffering', async () => {
    const start = performance.now();
    const res = await fetch(`${plain.baseUrl}/streaming`);
    expect(res.status).toBe(200);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let firstChunkAt = 0;
    let payloadAt = 0;
    let html = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!firstChunkAt) firstChunkAt = performance.now() - start;
      html += decoder.decode(value, { stream: true });
      if (!payloadAt && html.includes('LATE_PAYLOAD')) {
        payloadAt = performance.now() - start;
      }
    }

    expect(html).toContain('shell-ready');
    expect(html).toContain('LATE_PAYLOAD');
    // the shell must arrive well before the 400ms promise resolves; the
    // payload cannot arrive before it
    expect(firstChunkAt).toBeLessThan(300);
    expect(payloadAt).toBeGreaterThanOrEqual(380);
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
