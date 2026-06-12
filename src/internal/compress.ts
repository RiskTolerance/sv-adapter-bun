import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';

// mirrors @sveltejs/kit's builder.compress() file selection
const extensions = [
  '.html',
  '.js',
  '.mjs',
  '.json',
  '.css',
  '.svg',
  '.xml',
  '.wasm',
  '.txt',
];

type ZstdCompress = (data: Uint8Array) => Uint8Array;

/**
 * Resolves a zstd compressor for the current runtime: Bun's native API when
 * the adapter runs under Bun, node:zlib otherwise (zstd landed in Node
 * 22.15 / 23.8). Returns null when neither is available so the caller can
 * skip with a warning instead of failing the build.
 */
async function get_zstd(level: number): Promise<ZstdCompress | null> {
  if (
    typeof Bun !== 'undefined' &&
    typeof Bun.zstdCompressSync === 'function'
  ) {
    return data => Bun.zstdCompressSync(data, { level });
  }

  const zlib = await import('node:zlib');
  if (typeof zlib.zstdCompressSync === 'function') {
    return data =>
      zlib.zstdCompressSync(data, {
        params: { [zlib.constants.ZSTD_c_compressionLevel]: level },
      });
  }

  return null;
}

/**
 * Writes a `.zst` sibling for every compressible file under dir, like kit's
 * builder.compress() does for gzip and brotli. Returns false when the
 * runtime has no zstd support (the build continues without zstd variants).
 */
export async function zstd_compress_dir(
  dir: string,
  level = 19
): Promise<boolean> {
  if (!existsSync(dir)) return true;

  const zstd = await get_zstd(level);
  if (!zstd) return false;

  for (const entry of readdirSync(dir, { recursive: true }) as string[]) {
    if (!extensions.includes(extname(entry))) continue;
    const path = join(dir, entry);
    const source = readFileSync(path);
    const compressed = zstd(source);
    // tiny files inflate — only emit a variant that actually saves bytes
    if (compressed.byteLength < source.byteLength) {
      writeFileSync(`${path}.zst`, compressed);
    }
  }

  return true;
}
