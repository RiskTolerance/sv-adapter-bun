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
  export const appDir: string;
  export const base: string;
  export const prerendered: Set<string>;
}

declare module 'SERVER' {
  import type { Server } from '@sveltejs/kit';

  export const server: Server;
}

declare module 'WEBSOCKET_HOOKS' {
  export const websocket: Bun.WebSocketHandler<undefined> | undefined;
}

declare const BUILD_OPTIONS: {
  serveAssets: boolean;
  idleTimeout?: number;
  origin?: string;
};
declare const ENV_PREFIX: string;
