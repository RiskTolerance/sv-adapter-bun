import type { Adapter } from '@sveltejs/kit';
import './ambient.js';

type Bundler = 'bun' | 'rolldown';

interface AdapterOptions {
  out?: string;
  precompress?: boolean;
  envPrefix?: string;
  /**
   * Default idle timeout for Bun.serve in seconds (0 disables, max 255).
   * Overridable at runtime with the IDLE_TIMEOUT environment variable.
   */
  idleTimeout?: number;
  /**
   * Which bundler gets the first attempt at producing the server bundle.
   * @default 'rolldown'
   */
  bundler?: Bundler;
  /**
   * Bundle the app's hooks.server module so the server can use its websocket
   * export. Set false for apps without WebSockets.
   * @default true
   */
  websockets?: boolean;
  /**
   * If enabled, the adapter will serve static assets.
   * @default true
   */
  serveAssets?: boolean;
}

export default function adapter(options?: AdapterOptions): Adapter;
