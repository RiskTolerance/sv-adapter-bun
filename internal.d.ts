declare module 'ENV' {
  export function env(key: string, fallback?: any): string;
}

declare module 'HANDLER' {
  export const getHandler: () => {
    fetch: (
      request: Request,
      server: Bun.Server
    ) => Response | Promise<Response>;
    websocket: Bun.WebSocketHandler<undefined> | undefined;
  };
}

declare module 'MANIFEST' {
  import type { SSRManifest } from '@sveltejs/kit';

  export const base: string;
  export const manifest: SSRManifest;
  export const prerendered: Set<string>;
}

declare module 'SERVER' {
  export { Server } from '@sveltejs/kit';
}

declare module 'WEBSOCKET_HOOKS' {
  export const websocket: Bun.WebSocketHandler<undefined> | undefined;
}

declare const BUILD_OPTIONS: { serveAssets: boolean; idleTimeout?: number };
declare const ENV_PREFIX: string;
