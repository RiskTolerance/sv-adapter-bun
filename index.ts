import type { Adapter, Builder } from '@sveltejs/kit';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';
import { bundle_server, type BundleConfig } from './src/internal/bundle';
import { patch_server_websocket_handler } from './src/internal/websocket_patch';

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
}

const files = fileURLToPath(new URL('./files', import.meta.url).href);

export default function (options: AdapterOptions = {}): Adapter {
  const {
    out = 'build',
    precompress = true,
    envPrefix = '',
    serveAssets = true,
    idleTimeout,
  } = options;

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
        await Promise.all([
          builder.compress(`${out}/client`),
          builder.compress(`${out}/prerendered`),
        ]);
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

      const bundle_config: BundleConfig = {
        entrypoints,
        outdir: `${out}/server`,
        external: [
          // dependencies could have deep exports, so name + name/*
          ...Object.keys({
            ...pkg.dependencies,
            ...pkg.peerDependencies,
            ...pkg.optionalDependencies,
          }).flatMap(d => [d, `${d}/*`]),
          // Node.js built-in modules, with and without the node: prefix
          'node:*',
          ...builtinModules.flatMap(m => [m, `${m}/*`]),
          // Bun runtime modules (bun, bun:sqlite, bun:test, ...)
          'bun',
          'bun:*',
        ],
      };

      // Bundling needs Bun.build (Bun >= 1.3.6 — older versions produced a
      // bundle that threw lifecycle_outside_component at runtime, upstream
      // #82). Under `bun --bun vite build` the Bun global is right here;
      // under plain `vite build` (Node) we delegate to a Bun subprocess.
      if (typeof Bun !== 'undefined') {
        await bundle_server(bundle_config);
      } else {
        const config_path = `${tmp}/bundle-config.json`;
        writeFileSync(config_path, JSON.stringify(bundle_config));
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
      }

      builder.log.minor('Patching server for WebSocket support');
      const hooks_file = builder.config.kit.files.hooks.server;
      const has_server_hooks = builder.config.kit.moduleExtensions.some(ext =>
        existsSync(`${hooks_file}${ext}`)
      );
      patchServerWebsocketHandler(`${out}/server/index.js`, has_server_hooks);

      builder.copy(files, out, {
        replace: {
          ENV: './env.js',
          HANDLER: './handler.js',
          MANIFEST: './server/manifest.js',
          SERVER: './server/index.js',
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

/**
 * Patch sveltekit server to return the websocket handler. Throws when kit's
 * internals no longer match the patch patterns.
 */
function patchServerWebsocketHandler(path: string, has_server_hooks: boolean) {
  const content = readFileSync(path, 'utf-8');
  writeFileSync(
    path,
    patch_server_websocket_handler(content, has_server_hooks)
  );
}
