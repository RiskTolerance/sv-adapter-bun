import adapter from '@risk-tolerance/svelte-adapter-bun';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  // Consult https://svelte.dev/docs/kit/integrations
  // for more information about preprocessors
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(
      process.env.ADAPTER_BUNDLER
        ? { bundler: process.env.ADAPTER_BUNDLER }
        : {}
    ),
  },
};

export default config;
