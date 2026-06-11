export const MIN_BUN_VERSION = '1.3.6';

export type Bundler = 'bun' | 'rolldown';

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
  bundler: Bundler;
  entrypoints: string[];
  outdir: string;
  /**
   * Bare package names to externalize (the consumer app's dependencies).
   * Each bundler expands these plus the Node/Bun built-ins to its own
   * pattern syntax.
   */
  external_packages: string[];
}

/**
 * Bundles the kit server output. The bun bundler must run in a Bun process
 * (either the adapter itself under `bun --bun vite build`, or the subprocess
 * spawned by the adapter); rolldown runs in-process under Node or Bun.
 */
export async function bundle_server(config: BundleConfig): Promise<void> {
  if (config.bundler === 'rolldown') {
    return bundle_with_rolldown(config);
  }
  return bundle_with_bun(config);
}

async function bundle_with_bun(config: BundleConfig): Promise<void> {
  if (!is_at_least(Bun.version, MIN_BUN_VERSION)) {
    throw new Error(
      `svelte-adapter-bun requires Bun >= ${MIN_BUN_VERSION} to bundle the server (found ${Bun.version}). Older versions produce a bundle that fails at runtime with lifecycle_outside_component. Alternatively, install rolldown and set the bundler: 'rolldown' adapter option.`
    );
  }

  const { builtinModules } = await import('node:module');

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
    external: [
      ...config.external_packages.flatMap(d => [d, `${d}/*`]),
      'node:*',
      ...builtinModules.flatMap(m => [m, `${m}/*`]),
      'bun',
      'bun:*',
    ],
  });

  if (!result.success) {
    throw new AggregateError(result.logs, 'Server bundling failed');
  }
}

async function bundle_with_rolldown(config: BundleConfig): Promise<void> {
  let rolldown: (typeof import('rolldown'))['rolldown'];
  try {
    ({ rolldown } = await import('rolldown'));
  } catch {
    throw new Error(
      "The bundler: 'rolldown' adapter option requires rolldown to be installed — add it to your devDependencies (bun add -d rolldown)."
    );
  }

  const { builtinModules } = await import('node:module');

  const bundle = await rolldown({
    input: config.entrypoints,
    external: [
      ...config.external_packages.map(d => new RegExp(`^${d}(\\/.*)?$`)),
      /^node:/,
      ...builtinModules.map(m => new RegExp(`^${m}(\\/.*)?$`)),
      /^bun(:.*)?$/,
    ],
  });

  try {
    await bundle.write({
      dir: config.outdir,
      format: 'esm',
      sourcemap: true,
      chunkFileNames: 'chunks/[name]-[hash].js',
    });
  } finally {
    await bundle.close();
  }
}
