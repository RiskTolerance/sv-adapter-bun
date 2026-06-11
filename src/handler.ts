/* global ENV_PREFIX */
import { manifest, base, prerendered } from 'MANIFEST';
import { Server } from 'SERVER';
import { env } from 'ENV';
import type { Server as SvelteKitServer } from '@sveltejs/kit';
import { existsSync } from 'node:fs';
import type { RequestHandler } from 'sirv';
import sirv from 'sirv';
import { get_origin } from './internal/origin';

const server = new Server(manifest) as SvelteKitServer & {
  websocket(): unknown;
};

const { serveAssets } = BUILD_OPTIONS;

const origin = env('ORIGIN', undefined);
const xff_depth = parseInt(env('XFF_DEPTH', '1'), 10);
const address_header = env('ADDRESS_HEADER', '').toLowerCase();
const protocol_header = env('PROTOCOL_HEADER', '').toLowerCase();
const host_header = env('HOST_HEADER', '').toLowerCase();
const port_header = env('PORT_HEADER', '').toLowerCase();

const asset_dir = `${import.meta.dir}/client${base}`;

await server.init({
  env: Bun.env as Record<string, string>,
  read: file => Bun.file(`${asset_dir}/${file}`).stream(),
});

function serve(path: string, client: boolean = false) {
  if (existsSync(path)) {
    return sirv(path, {
      etag: true,
      gzip: true,
      brotli: true,
      setHeaders: client
        ? (headers, pathname) => {
            if (pathname.startsWith(`/${manifest.appDir}/immutable/`)) {
              headers.set('cache-control', 'public,max-age=31536000,immutable');
            }
            return headers;
          }
        : undefined,
    });
  }
}

// required because the static file server ignores trailing slashes
function serve_prerendered(): RequestHandler {
  const handler = serve(`${import.meta.dir}/prerendered`, false)!;

  return (req, next, rawPathname) => {
    let pathname = rawPathname ?? new URL(req.url).pathname;

    try {
      pathname = decodeURIComponent(pathname);
    } catch {
      // ignore invalid URI
    }

    if (prerendered.has(pathname)) {
      return handler(req, next, rawPathname);
    }

    // remove or add trailing slash as appropriate
    let location =
      pathname.at(-1) === '/' ? pathname.slice(0, -1) : pathname + '/';
    if (prerendered.has(location)) {
      const qi = req.url.indexOf('?');
      if (qi !== -1) location += req.url.slice(qi);
      return new Response(null, { status: 308, headers: { location } });
    } else {
      return next?.() || new Response(null, { status: 404 });
    }
  };
}

const ssr = async (request: Request, bunServer: Bun.Server<undefined>) => {
  const baseOrigin =
    origin ||
    get_origin(request.headers, { protocol_header, host_header, port_header });
  const url = request.url.slice(request.url.split('/', 3).join('/').length);
  const newRequest = new Request(baseOrigin + url, request);

  return server.respond(newRequest, {
    platform: { server: bunServer, request },
    getClientAddress() {
      if (address_header) {
        if (!request.headers.has(address_header)) {
          throw new Error(
            `Address header was specified with ${
              ENV_PREFIX + 'ADDRESS_HEADER'
            }=${address_header} but is absent from request`
          );
        }

        const value = request.headers.get(address_header) || '';

        if (address_header === 'x-forwarded-for') {
          const addresses = value.split(',');

          if (xff_depth < 1) {
            throw new Error(
              `${ENV_PREFIX + 'XFF_DEPTH'} must be a positive integer`
            );
          }

          if (xff_depth > addresses.length) {
            throw new Error(
              `${ENV_PREFIX + 'XFF_DEPTH'} is ${xff_depth}, but only found ${
                addresses.length
              } addresses`
            );
          }
          return addresses[addresses.length - xff_depth]?.trim() || '';
        }

        return value;
      }

      return bunServer.requestIP(request)?.address || '';
    },
  });
};

export const getHandler = () => {
  const websocket = server.websocket();

  const staticHandlers = [
    serveAssets && serve(`${import.meta.dir}/client${base}`, true),
    serveAssets && serve_prerendered(),
  ].filter(Boolean) as RequestHandler[];

  const handler = (request: Request, server: Bun.Server<undefined>) => {
    // parse once — every static handler down the chain reuses it
    const pathname = new URL(request.url).pathname;

    function handle(i: number): Response | Promise<Response> {
      if (i < staticHandlers.length) {
        return staticHandlers[i]!(request, () => handle(i + 1), pathname);
      } else {
        return ssr(request, server);
      }
    }

    return handle(0);
  };

  return {
    fetch: handler,
    websocket,
  };
};
