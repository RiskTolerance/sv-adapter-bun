import adapter, {
  type AdapterOptions,
} from '@risk-tolerance/svelte-adapter-bun';
import { sveltekit } from '@sveltejs/kit/vite';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

// the integration suite drives adapter options through the environment
const adapterOptions: AdapterOptions = {};
if (process.env.ADAPTER_BUNDLER)
  adapterOptions.bundler = process.env.ADAPTER_BUNDLER as 'bun' | 'rolldown';
if (process.env.ADAPTER_NO_WEBSOCKETS) adapterOptions.websockets = false;

export default defineConfig({
  plugins: [
    sveltekit({
      preprocess: vitePreprocess(),
      adapter: adapter(adapterOptions),
    }),
  ],
});
