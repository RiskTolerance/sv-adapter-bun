/*! MIT © Luke Edwards https://github.com/lukeed/sirv/blob/master/packages/sirv/index.js */
import type { Stats } from 'fs';
import { resolve } from 'path';
import { totalist } from 'totalist/sync';
import { lookup } from 'mrmime';

// Type definitions
type Arrayable<T> = T | T[];

export type NextHandler = () => Response | Promise<Response>;

export type RequestHandler = (
  req: Request,
  next?: NextHandler,
  pathname?: string
) => Response | Promise<Response>;

export interface Options {
  // dev?: boolean;
  etag?: boolean;
  maxAge?: number;
  immutable?: boolean;
  // single?: string | boolean;
  ignores?: false | Arrayable<string | RegExp>;
  extensions?: string[];
  dotfiles?: boolean;
  brotli?: boolean;
  gzip?: boolean;
  zstd?: boolean;
  onNoMatch?: (req: Request) => Response;
  setHeaders?: (headers: Headers, pathname: string, stats: Stats) => Headers;
}

function isMatch(uri: string, arr: RegExp[]) {
  for (let i = 0; i < arr.length; i++) {
    if (arr[i]?.test(uri)) return true;
  }
}

function toAssume(uri: string, extns: string[]) {
  let i = 0,
    x,
    len = uri.length - 1;
  if (uri.charCodeAt(len) === 47) {
    uri = uri.substring(0, len);
  }

  const arr = [],
    tmp = `${uri}/index`;
  for (; i < extns.length; i++) {
    x = extns[i] ? `.${extns[i]}` : '';
    if (uri) arr.push(uri + x);
    arr.push(tmp + x);
  }

  return arr;
}

function viaCache(
  cache: Record<string, any>,
  uri: string,
  extns: string[]
): { abs: string; stats: Stats; headers: Headers } | undefined {
  let i = 0,
    data,
    arr = toAssume(uri, extns);
  for (; i < arr.length; i++) {
    if ((data = cache[arr[i]!])) return data;
  }
}

// function viaLocal(dir: string, isEtag: boolean, uri: string, extns: string[]) {
//     let i = 0, arr = toAssume(uri, extns);
//     let abs, stats, name, headers;
//     for (; i < arr.length; i++) {
//         abs = normalize(
//             join(dir, name = arr[i]!)
//         );

//         if (abs.startsWith(dir) && fs.existsSync(abs)) {
//             stats = fs.statSync(abs);
//             if (stats.isDirectory()) continue;
//             headers = toHeaders(name, stats, isEtag);
//             headers.set('Cache-Control', isEtag ? 'no-cache' : 'no-store');
//             return { abs, stats, headers };
//         }
//     }
// }

function is404(req: Request) {
  return new Response(null, {
    status: 404,
    statusText: '404',
  });
}

export type RangeResult =
  | { kind: 'range'; start: number; end: number }
  // syntactically invalid specs (reversed bounds, non-bytes units,
  // multipart ranges we don't support) — RFC 7233 says ignore the header
  | { kind: 'invalid' }
  // syntactically valid but nothing to serve — 416
  | { kind: 'unsatisfiable' };

export function parse_range(value: string, size: number): RangeResult {
  // single byte range only; multipart ranges fall through to a full 200,
  // which RFC 7233 permits (a server MAY ignore the Range header)
  const m = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!m) return { kind: 'invalid' };
  const [, first, last] = m;

  if (first === '' && last === '') return { kind: 'invalid' };
  if (size === 0) return { kind: 'unsatisfiable' };

  if (first === '') {
    // suffix range: the last N bytes
    const n = Number(last);
    if (n === 0) return { kind: 'unsatisfiable' };
    return { kind: 'range', start: Math.max(0, size - n), end: size - 1 };
  }

  const start = Number(first);
  if (start >= size) return { kind: 'unsatisfiable' };

  if (last === '') return { kind: 'range', start, end: size - 1 };

  const end = Number(last);
  if (end < start) return { kind: 'invalid' };
  return { kind: 'range', start, end: Math.min(end, size - 1) };
}

function send(
  req: Request,
  data: { abs: string; stats: Stats; headers: Headers }
) {
  const range_header = req.headers.get('range');

  if (range_header) {
    const range = parse_range(range_header, data.stats.size);

    if (range.kind === 'unsatisfiable') {
      // clone — the cached headers must not carry range fields
      const headers = new Headers(data.headers);
      headers.delete('Content-Length');
      headers.set('Content-Range', `bytes */${data.stats.size}`);
      return new Response(null, { headers, status: 416 });
    }

    if (range.kind === 'range') {
      const headers = new Headers(data.headers);
      headers.set(
        'Content-Range',
        `bytes ${range.start}-${range.end}/${data.stats.size}`
      );
      headers.set('Content-Length', (range.end - range.start + 1).toString());
      headers.set('Accept-Ranges', 'bytes');
      return new Response(
        Bun.file(data.abs).slice(range.start, range.end + 1),
        {
          headers,
          status: 206,
        }
      );
    }

    // invalid spec — ignore the header and serve the full file
  }

  return new Response(Bun.file(data.abs), {
    headers: data.headers,
    status: 200,
  });
}

const ENCODING: Record<string, string> = {
  '.br': 'br',
  '.gz': 'gzip',
  '.zst': 'zstd',
};

function toHeaders(name: string, stats: Stats, isEtag: boolean) {
  const ext = ['.br', '.gz', '.zst'].find(x => name.endsWith(x));
  const enc = ext && ENCODING[ext];

  let ctype = lookup(ext ? name.slice(0, -ext.length) : name) || '';
  if (ctype === 'text/html') ctype += ';charset=utf-8';

  const headers = new Headers({
    'Content-Length': stats.size.toString(),
    'Content-Type': ctype,
    'Last-Modified': stats.mtime.toUTCString(),
  });

  if (enc) headers.set('Content-Encoding', enc);
  if (isEtag) headers.set('ETag', `W/"${stats.size}-${stats.mtime.getTime()}"`);

  return headers;
}

export default function (dir: string, opts: Options = {}): RequestHandler {
  dir = resolve(dir || '.');

  const isNotFound = opts.onNoMatch || is404;
  const setHeaders = opts.setHeaders;

  const extensions = opts.extensions || ['html', 'htm'];
  const gzips = opts.gzip && extensions.map(x => `${x}.gz`).concat('gz');
  const brots = opts.brotli && extensions.map(x => `${x}.br`).concat('br');
  const zsts = opts.zstd && extensions.map(x => `${x}.zst`).concat('zst');

  const FILES: Record<string, { abs: string; stats: Stats; headers: Headers }> =
    {};

  const fallback = '/';
  const isEtag = !!opts.etag;
  // let isSPA = !!opts.single;
  // if (typeof opts.single === 'string') {
  //     let idx = opts.single.lastIndexOf('.');
  //     fallback += !!~idx ? opts.single.substring(0, idx) : opts.single;
  // }

  const ignores: RegExp[] = [];
  if (opts.ignores !== false) {
    ignores.push(/[/]([A-Za-z\s\d~$._-]+\.\w+){1,}$/); // any extn
    if (opts.dotfiles) {
      ignores.push(/\/\.\w/);
    } else {
      ignores.push(/\/\.well-known/);
    }

    if (opts.ignores && Array.isArray(opts.ignores)) {
      ignores.push(...opts.ignores.map(x => new RegExp(x, 'i')));
    } else if (typeof opts.ignores === 'string') {
      ignores.push(new RegExp(opts.ignores, 'i'));
    }
  }

  let CacheControl = opts.maxAge != null && `public,max-age=${opts.maxAge}`;
  if (CacheControl && opts.immutable) CacheControl += ',immutable';
  else if (CacheControl && opts.maxAge === 0)
    CacheControl += ',must-revalidate';

  // if (!opts.dev) {
  totalist(dir, (name, abs, stats) => {
    if (/\.well-known[\\+/]/.test(name)) {
    } // keep
    else if (!opts.dotfiles && /(^\.|[\\+|/+]\.)/.test(name)) return;

    let headers = toHeaders(name, stats, isEtag);
    if (CacheControl) headers.set('Cache-Control', CacheControl);
    if (gzips || brots || zsts) headers.set('Vary', 'Accept-Encoding');

    // setHeaders is deterministic per file, so apply it once here instead
    // of cloning + mutating the cached headers on every request
    const pathname = '/' + name.normalize().replace(/\\+/g, '/');
    if (setHeaders) headers = setHeaders(headers, pathname, stats);

    FILES[pathname] = {
      abs,
      stats,
      headers,
    };
  });
  // }

  const lookup =
    /*opts.dev ? viaLocal.bind(0, dir + sep, isEtag) :*/ viaCache.bind(
      0,
      FILES
    );

  return (req, next, rawPathname) => {
    const extns = [''];
    let pathname = rawPathname ?? new URL(req.url).pathname;
    // range requests get the identity encoding — a byte range of a
    // precompressed variant is undecodable for the client
    if (!req.headers.has('range')) {
      const val = req.headers.get('accept-encoding') || '';
      if (gzips && val.includes('gzip')) extns.unshift(...gzips);
      if (zsts && /\bzstd\b/i.test(val)) extns.unshift(...zsts);
      if (brots && /(br|brotli)/i.test(val)) extns.unshift(...brots);
    }
    extns.push(...extensions); // [...br, ...zst, ...gz, orig, ...exts]

    if (pathname.indexOf('%') !== -1) {
      try {
        pathname = decodeURI(pathname);
      } catch (err) {
        /* malform uri */
      }
    }

    const data =
      lookup(pathname, extns) ||
      (isMatch(pathname, ignores) && lookup(fallback, extns));
    if (!data) return next ? next() : isNotFound(req);

    if (
      isEtag &&
      req.headers.get('if-none-match') === data.headers.get('ETag')
    ) {
      return new Response(null, {
        status: 304,
      });
    }

    // the Response constructor copies the headers, so the cached Headers
    // object is safe to share across requests; send() clones it only for
    // range responses
    return send(req, data);
  };
}
