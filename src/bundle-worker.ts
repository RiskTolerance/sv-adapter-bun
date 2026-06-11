// Spawned by the adapter when the SvelteKit build runs under Node (plain
// `vite build`), where Bun.build is unavailable. Receives the bundle config
// as a JSON file path.
import { readFileSync } from 'node:fs';
import { bundle_server, type BundleConfig } from './internal/bundle';

const config_path = process.argv[2];
if (!config_path) {
  console.error('Usage: bun bundle-worker.js <config.json>');
  process.exit(1);
}

const config: BundleConfig = JSON.parse(readFileSync(config_path, 'utf-8'));
await bundle_server(config);
