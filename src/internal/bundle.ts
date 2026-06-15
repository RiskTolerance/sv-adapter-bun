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

// Bun.build cannot always chunk a dependency graph: some packages (e.g.
// better-auth) make it emit two chunks with the same output path, failing
// with "Multiple files share the same output path". rolldown handles these.
const CHUNK_COLLISION = /share the same output path/i;

/** Collects every message string reachable from a thrown value. */
function error_messages(err: unknown): string[] {
  if (err == null) return [];
  if (typeof err === 'string') return [err];
  const out: string[] = [];
  const message = (err as { message?: unknown }).message;
  if (typeof message === 'string') out.push(message);
  // AggregateError.errors, and the Bun build logs we wrap in one
  const nested =
    (err as { errors?: unknown }).errors ?? (err as { logs?: unknown }).logs;
  if (Array.isArray(nested)) {
    for (const item of nested) out.push(...error_messages(item));
  }
  const cause = (err as { cause?: unknown }).cause;
  if (cause) out.push(...error_messages(cause));
  return out;
}

export function is_chunk_collision(err: unknown): boolean {
  return error_messages(err).some(m => CHUNK_COLLISION.test(m));
}

async function has_rolldown(): Promise<boolean> {
  try {
    await import('rolldown');
    return true;
  } catch {
    return false;
  }
}

export interface BundleImpls {
  bun: (config: BundleConfig) => Promise<void>;
  rolldown: (config: BundleConfig) => Promise<void>;
  hasRolldown: () => Promise<boolean>;
  warn: (message: string) => void;
}

const DEFAULT_IMPLS: BundleImpls = {
  bun: bundle_with_bun,
  rolldown: bundle_with_rolldown,
  hasRolldown: has_rolldown,
  warn: message => console.warn(message),
};

/**
 * Bundles the kit server output. The bun bundler must run in a Bun process
 * (either the adapter itself under `bun --bun vite build`, or the subprocess
 * spawned by the adapter); rolldown runs in-process under Node or Bun.
 *
 * When the default bun bundler hits a chunk naming conflict, this falls back
 * to rolldown if it is installed — turning a hard failure into a transparent
 * recovery. The impls parameter exists for tests.
 */
export async function bundle_server(
  config: BundleConfig,
  impls: Partial<BundleImpls> = {}
): Promise<void> {
  const { bun, rolldown, hasRolldown, warn } = { ...DEFAULT_IMPLS, ...impls };

  if (config.bundler === 'rolldown') {
    return rolldown(config);
  }

  try {
    return await bun(config);
  } catch (err) {
    if (!is_chunk_collision(err)) throw err;

    if (await hasRolldown()) {
      warn(
        'svelte-adapter-bun: Bun.build hit a chunk naming conflict; retrying ' +
          "with rolldown. Set the bundler: 'rolldown' adapter option to use " +
          'rolldown directly and silence this warning.'
      );
      return rolldown(config);
    }

    throw new Error(
      'Bun.build failed with a chunk naming conflict (some dependency ' +
        'graphs, such as better-auth, trigger this). Install rolldown ' +
        '(bun add -d rolldown) for an automatic fallback, or set the ' +
        "bundler: 'rolldown' adapter option.",
      { cause: err }
    );
  }
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
