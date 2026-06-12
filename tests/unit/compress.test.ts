import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { zstd_compress_dir } from '../../src/internal/compress';

const DIR = '/tmp/sv-adapter-bun-zstd-test';

const JS_CONTENT = 'console.log("hello hello hello");\n'.repeat(50);

beforeAll(() => {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(`${DIR}/nested`, { recursive: true });
  writeFileSync(`${DIR}/app.js`, JS_CONTENT);
  writeFileSync(
    `${DIR}/nested/page.html`,
    `<html><body>${'hi '.repeat(200)}</body></html>\n`
  );
  writeFileSync(`${DIR}/photo.png`, 'not-really-a-png');
  writeFileSync(`${DIR}/app.js.gz`, 'pretend-gzip');
  writeFileSync(`${DIR}/tiny.js`, 'x();\n');
});

afterAll(() => {
  rmSync(DIR, { recursive: true, force: true });
});

describe('zstd_compress_dir', () => {
  test('emits decodable .zst siblings for compressible files only', async () => {
    expect(await zstd_compress_dir(DIR)).toBe(true);

    const js = Bun.file(`${DIR}/app.js.zst`);
    expect(await js.exists()).toBe(true);
    expect(
      Buffer.from(
        Bun.zstdDecompressSync(new Uint8Array(await js.arrayBuffer()))
      ).toString()
    ).toBe(JS_CONTENT);

    expect(await Bun.file(`${DIR}/nested/page.html.zst`).exists()).toBe(true);

    // non-compressible and already-compressed files are skipped
    expect(await Bun.file(`${DIR}/photo.png.zst`).exists()).toBe(false);
    expect(await Bun.file(`${DIR}/app.js.gz.zst`).exists()).toBe(false);

    // files that compression would inflate get no variant
    expect(await Bun.file(`${DIR}/tiny.js.zst`).exists()).toBe(false);
  });

  test('tolerates a missing directory', async () => {
    expect(await zstd_compress_dir('/tmp/does-not-exist-xyz')).toBe(true);
  });
});
