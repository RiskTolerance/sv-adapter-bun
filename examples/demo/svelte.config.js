import adapter from '@risk-tolerance/svelte-adapter-bun';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// the integration suite drives adapter options through the environment
const adapterOptions = {};
if (process.env.ADAPTER_BUNDLER)
  adapterOptions.bundler = process.env.ADAPTER_BUNDLER;
if (process.env.ADAPTER_NO_WEBSOCKETS) adapterOptions.websockets = false;

/** @type {import('@sveltejs/kit').Config} */
const config = {
  // Consult https://svelte.dev/docs/kit/integrations
  // for more information about preprocessors
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(adapterOptions),
  },
};

export default config;
