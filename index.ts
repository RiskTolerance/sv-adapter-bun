import type { Adapter, Builder } from '@sveltejs/kit';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  bundle_server,
  type BundleConfig,
  type Bundler,
} from './src/internal/bundle';
import { zstd_compress_dir } from './src/internal/compress';

interface AdapterOptions {
  out?: string;
  precompress?: boolean;
  envPrefix?: string;
  serveAssets?: boolean;
  /**
   * Default idle timeout for Bun.serve in seconds (0 disables, max 255).
   * Overridable at runtime with the IDLE_TIMEOUT environment variable.
   */
  idleTimeout?: number;
  /**
   * Which bundler gets the first attempt at producing the server bundle.
   * 'rolldown' (default) runs in-process under Node or Bun; 'bun' uses
   * Bun.build first. Either choice falls back to the other bundler on failure.
   */
  bundler?: Bundler;
  /**
   * Bundle the app's hooks.server module so the server can use its
   * websocket export (default true). Set false for apps without WebSockets
   * — the server then runs plain HTTP.
   */
  websockets?: boolean;
}

const files = fileURLToPath(new URL('./files', import.meta.url).href);

export default function (options: AdapterOptions = {}): Adapter {
  const {
    out = 'build',
    precompress = true,
    envPrefix = '',
    serveAssets = true,
    idleTimeout,
    bundler = 'rolldown',
    websockets = true,
  } = options;

  if (bundler !== 'bun' && bundler !== 'rolldown') {
    throw new Error(
      `Invalid bundler adapter option: ${JSON.stringify(bundler)}. Expected 'bun' or 'rolldown'.`
    );
  }

  if (
    idleTimeout !== undefined &&
    (!Number.isInteger(idleTimeout) || idleTimeout < 0 || idleTimeout > 255)
  ) {
    throw new Error(
      `Invalid idleTimeout adapter option: ${idleTimeout}. Bun.serve accepts an integer between 0 (disabled) and 255 seconds.`
    );
  }

  return {
    name: 'svelte-adapter-bun',
    async adapt(builder: Builder) {
      const tmp = builder.getBuildDirectory('adapter-bun');

      builder.rimraf(out);
      builder.rimraf(tmp);
      builder.mkdirp(tmp);

      builder.log.minor('Copying assets');
      builder.writeClient(`${out}/client${builder.config.kit.paths.base}`);
      builder.writePrerendered(
        `${out}/prerendered${builder.config.kit.paths.base}`
      );

      if (precompress) {
        builder.log.minor('Compressing assets');
        // kit's builder.compress emits gzip + brotli; zstd is ours
        await Promise.all([
          builder.compress(`${out}/client`),
          builder.compress(`${out}/prerendered`),
        ]);
        const zstd_ok =
          (await zstd_compress_dir(`${out}/client`)) &&
          (await zstd_compress_dir(`${out}/prerendered`));
        if (!zstd_ok) {
          builder.log.warn(
            'Skipping zstd precompression — requires Bun or Node >= 22.15 at build time'
          );
        }
      }

      builder.log.minor('Building server');

      builder.writeServer(tmp);

      writeFileSync(
        `${tmp}/manifest.js`,
        [
          `export const manifest = ${builder.generateManifest({ relativePath: './' })};`,
          `export const prerendered = new Set(${JSON.stringify(builder.prerendered.paths)});`,
          `export const base = ${JSON.stringify(builder.config.kit.paths.base)};`,
        ].join('\n\n')
      );

      const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));

      const entrypoints = [`${tmp}/index.js`, `${tmp}/manifest.js`];

      if (builder.hasServerInstrumentationFile?.()) {
        entrypoints.push(`${tmp}/instrumentation.server.js`);
      }

      // WebSocket support: the app's hooks.server module is bundled as its
      // own entrypoint so the runtime can read its `websocket` export
      // directly. Code splitting dedupes it into a shared chunk, so kit's
      // own dynamic import of the hooks module sees the same instance.
      const hooks_file = builder.config.kit.files.hooks.server;
      const has_server_hooks = builder.config.kit.moduleExtensions.some(ext =>
        existsSync(`${hooks_file}${ext}`)
      );
      const bundle_websocket_hooks = websockets && has_server_hooks;

      if (bundle_websocket_hooks) {
        const hooks_entry = `${tmp}/entries/hooks.server.js`;
        if (!existsSync(hooks_entry)) {
          throw new Error(
            `Found a server hooks file but SvelteKit's build output has no ` +
              `entries/hooks.server.js — kit's output layout has likely ` +
              `changed. Please report this at ` +
              `https://github.com/RiskTolerance/sv-adapter-bun/issues`
          );
        }
        entrypoints.push(hooks_entry);
      }

      const bundle_config: BundleConfig = {
        bundler,
        entrypoints,
        outdir: `${out}/server`,
        external_packages: Object.keys({
          ...pkg.dependencies,
          ...pkg.peerDependencies,
          ...pkg.optionalDependencies,
        }),
      };

      const bundle_with_bun_subprocess = async (config: BundleConfig) => {
        const config_path = `${tmp}/bundle-config.json`;
        writeFileSync(config_path, JSON.stringify(config));
        const worker = fileURLToPath(
          new URL('./bundle-worker.js', import.meta.url)
        );
        const spawned = spawnSync('bun', [worker, config_path], {
          stdio: 'inherit',
        });
        if (spawned.error || spawned.status !== 0) {
          throw new Error(
            `Server bundling failed${spawned.error ? ` (${spawned.error.message})` : ''}. ` +
              `svelte-adapter-bun needs the bun executable on PATH at build time ` +
              `(or run the build with 'bun --bun vite build').`
          );
        }
      };

      // Rolldown runs in-process under Node or Bun. Bun.build needs a Bun
      // process; when vite runs under Node, use a subprocess for explicit Bun
      // builds or for fallback after a rolldown failure.
      if (typeof Bun !== 'undefined') {
        await bundle_server(bundle_config);
      } else {
        await bundle_server(bundle_config, { bun: bundle_with_bun_subprocess });
      }

      let websocket_hooks_path: string;
      if (bundle_websocket_hooks) {
        // Bun.build preserves the entry's directory, rolldown flattens to
        // the basename — locate whichever the bundler emitted
        const emitted = ['entries/hooks.server.js', 'hooks.server.js'].find(
          candidate => existsSync(`${out}/server/${candidate}`)
        );
        if (!emitted) {
          throw new Error(
            `The bundler did not emit the hooks.server entrypoint where ` +
              `expected. Please report this at ` +
              `https://github.com/RiskTolerance/sv-adapter-bun/issues`
          );
        }
        websocket_hooks_path = `./server/${emitted}`;
      } else {
        // no hooks file (or websockets disabled) — plain HTTP server
        writeFileSync(
          `${out}/server/no-websocket-hooks.js`,
          'export const websocket = undefined;\n'
        );
        websocket_hooks_path = './server/no-websocket-hooks.js';
      }

      builder.copy(files, out, {
        replace: {
          ENV: './env.js',
          HANDLER: './handler.js',
          MANIFEST: './server/manifest.js',
          SERVER: './server/index.js',
          WEBSOCKET_HOOKS: websocket_hooks_path,
          ENV_PREFIX: JSON.stringify(envPrefix),
          BUILD_OPTIONS: JSON.stringify({ serveAssets, idleTimeout }),
        },
      });

      if (builder.hasServerInstrumentationFile?.()) {
        builder.instrument?.({
          entrypoint: `${out}/index.js`,
          instrumentation: `${out}/server/instrumentation.server.js`,
          module: {
            exports: ['path', 'host', 'port', 'server'],
          },
        });
      }
    },

    supports: {
      read: () => true,
      instrumentation: () => true,
    },
  };
}
