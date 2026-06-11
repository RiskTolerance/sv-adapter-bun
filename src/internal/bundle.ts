export const MIN_BUN_VERSION = '1.3.6';

/** Minimal semver-ish comparison — Bun.version is always x.y.z. */
export function is_at_least(version: string, minimum: string): boolean {
  const a = version.split('.').map(Number);
  const b = minimum.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return true;
}

export interface BundleConfig {
  entrypoints: string[];
  outdir: string;
  external: string[];
}

/**
 * Runs in a Bun process (either the adapter itself under `bun --bun vite
 * build`, or the subprocess spawned by run_bundle_subprocess).
 */
export async function bundle_server(config: BundleConfig): Promise<void> {
  if (!is_at_least(Bun.version, MIN_BUN_VERSION)) {
    throw new Error(
      `svelte-adapter-bun requires Bun >= ${MIN_BUN_VERSION} to bundle the server (found ${Bun.version}). Older versions produce a bundle that fails at runtime with lifecycle_outside_component.`
    );
  }

  const result = await Bun.build({
    entrypoints: config.entrypoints,
    outdir: config.outdir,
    target: 'bun',
    format: 'esm',
    // real ESM chunks with eager imports — without splitting, Bun wraps
    // shared modules in lazy __esm initializers, which breaks svelte's
    // SSR context module state at runtime
    splitting: true,
    minify: false,
    sourcemap: 'linked',
    naming: { chunk: 'chunks/[name]-[hash].js' },
    external: config.external,
  });

  if (!result.success) {
    throw new AggregateError(result.logs, 'Server bundling failed');
  }
}
