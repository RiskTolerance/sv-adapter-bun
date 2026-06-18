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

// Kept as a targeted helper because this Bun.build failure is common enough
// to document, even though fallback now applies to any bundler failure.
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

function first_error_message(err: unknown): string {
  return error_messages(err)[0] ?? 'unknown error';
}

export interface BundleImpls {
  bun: (config: BundleConfig) => Promise<void>;
  rolldown: (config: BundleConfig) => Promise<void>;
  warn: (message: string) => void;
}

const DEFAULT_IMPLS: BundleImpls = {
  bun: bundle_with_bun,
  rolldown: bundle_with_rolldown,
  warn: message => console.warn(message),
};

/**
 * Bundles the kit server output. The bun bundler must run in a Bun process
 * (either the adapter itself under `bun --bun vite build`, or the subprocess
 * spawned by the adapter); rolldown runs in-process under Node or Bun.
 *
 * The selected bundler is the primary. Any primary failure logs a warning and
 * retries with the other bundler. If both fail, the thrown AggregateError
 * keeps both original failures for diagnosis. The impls parameter exists for
 * tests.
 */
export async function bundle_server(
  config: BundleConfig,
  impls: Partial<BundleImpls> = {}
): Promise<void> {
  const { bun, rolldown, warn } = { ...DEFAULT_IMPLS, ...impls };
  const run = { bun, rolldown };
  const label = {
    bun: 'Bun.build',
    rolldown: 'rolldown',
  } satisfies Record<Bundler, string>;
  const primary = config.bundler;
  const fallback: Bundler = primary === 'rolldown' ? 'bun' : 'rolldown';

  try {
    return await run[primary](config);
  } catch (primary_err) {
    warn(
      `svelte-adapter-bun: ${label[primary]} failed ` +
        `(${first_error_message(primary_err)}); retrying with ${label[fallback]}.`
    );

    try {
      return await run[fallback](config);
    } catch (fallback_err) {
      throw new AggregateError(
        [primary_err, fallback_err],
        `${label[primary]} failed and fallback ${label[fallback]} failed`
      );
    }
  }
}

async function bundle_with_bun(config: BundleConfig): Promise<void> {
  if (!is_at_least(Bun.version, MIN_BUN_VERSION)) {
    throw new Error(
      `svelte-adapter-bun requires Bun >= ${MIN_BUN_VERSION} when bundling with Bun.build (found ${Bun.version}). Older versions produce a bundle that fails at runtime with lifecycle_outside_component. Use the default rolldown bundler or upgrade Bun.`
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
      "The rolldown bundler is unavailable. Reinstall @risk-tolerance/svelte-adapter-bun, or set bundler: 'bun' to use Bun.build first."
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
