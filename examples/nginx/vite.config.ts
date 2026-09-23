import adapter from '@risk-tolerance/svelte-adapter-bun';
import { sveltekit } from '@sveltejs/kit/vite';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    sveltekit({
      preprocess: vitePreprocess(),
      adapter: adapter({
        out: '_dist',
        serveAssets: false,
      }),
    }),
  ],
});
