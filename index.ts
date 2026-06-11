import type { Adapter, Builder } from '@sveltejs/kit';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';
import { patch_server_websocket_handler } from './src/internal/websocket_patch';

interface AdapterOptions {
  out?: string;
  precompress?: boolean;
  envPrefix?: string;
  serveAssets?: boolean;
}

const files = fileURLToPath(new URL('./files', import.meta.url).href);

export default function (options: AdapterOptions = {}): Adapter {
  const {
    out = 'build',
    precompress = true,
    envPrefix = '',
    serveAssets = true,
  } = options;

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

      const entrypoints: Record<string, string> = {
        index: `${tmp}/index.js`,
        manifest: `${tmp}/manifest.js`,
      };

      if (builder.hasServerInstrumentationFile?.()) {
        entrypoints['instrumentation.server'] =
          `${tmp}/instrumentation.server.js`;
      }

      // ! Bun.build is not working for some reason
      // ! It will build successfully but the server will throw [500] GET / Error: https://svelte.dev/e/lifecycle_outside_component
      // const result = await Bun.build({
      // 	entrypoints: Object.values(entrypoints),
      // 	external: [
      // 		// dependencies could have deep exports, so we need a regex
      // 		...Object.keys(pkg.dependencies || {}).map((d) => new RegExp(`^${d}(\\/.*)?$`).toString())
      // 	],
      // 	target: 'bun',
      // 	minify: false,
      // 	outdir: `${out}/server`,
      // });

      // if (!result.success) {
      // 	console.error('Build failed:', result.logs);
      // 	process.exit(1);
      // }

      const bundle = await rolldown({
        input: entrypoints,
        external: [
          // dependencies could have deep exports, so we need a regex
          ...Object.keys({
            ...pkg.dependencies,
            ...pkg.peerDependencies,
            ...pkg.optionalDependencies,
          }).map(d => new RegExp(`^${d}(\\/.*)?$`)),
          // Node.js built-in modules, with and without the node: prefix
          /^node:/,
          ...builtinModules.map(m => new RegExp(`^${m}(\\/.*)?$`)),
          // Bun runtime modules (bun, bun:sqlite, bun:test, ...)
          /^bun(:.*)?$/,
        ],
      });

      await bundle.write({
        dir: `${out}/server`,
        format: 'esm',
        sourcemap: true,
        chunkFileNames: 'chunks/[name]-[hash].js',
      });

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
          BUILD_OPTIONS: JSON.stringify({ serveAssets }),
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
