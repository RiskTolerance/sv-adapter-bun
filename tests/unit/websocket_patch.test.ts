import { describe, expect, test } from 'bun:test';
import { patch_server_websocket_handler } from '../../src/internal/websocket_patch';

const with_hooks = await Bun.file(
  new URL('../fixtures/kit-server-unpatched.txt', import.meta.url).pathname
).text();
const without_hooks = await Bun.file(
  new URL('../fixtures/kit-server-unpatched-no-hooks.txt', import.meta.url)
    .pathname
).text();
const with_hooks_bun_build = await Bun.file(
  new URL('../fixtures/kit-server-unpatched-bun-build.txt', import.meta.url)
    .pathname
).text();

function single(content: string) {
  return new Map([['index.js', content]]);
}

function patched_text(files: Map<string, string>, has_hooks = true) {
  const out = patch_server_websocket_handler(files, has_hooks);
  // merge: patched entries win, untouched entries fall through
  return [...new Map([...files, ...out]).values()].join('\n');
}

// the layout kit 2.57+ commonly produces: get_hooks() lives in a shared
// chunk while index.js keeps the call site and the Server class
function split_fixture() {
  const fn_start = with_hooks_bun_build.indexOf('async function get_hooks');
  const fn_end = with_hooks_bun_build.indexOf('\n}', fn_start) + 2;
  const chunk = with_hooks_bun_build.slice(fn_start, fn_end);
  const index =
    'import { t as get_hooks } from "./chunks/internal2.js";\n' +
    with_hooks_bun_build.slice(0, fn_start) +
    with_hooks_bun_build.slice(fn_end);
  return new Map([
    ['index.js', index],
    ['chunks/internal2.js', chunk],
  ]);
}

describe('patch_server_websocket_handler', () => {
  test('threads the websocket hook through a rolldown-bundled server', () => {
    const patched = patched_text(single(with_hooks));

    // get_hooks() declares, destructures and returns websocket
    expect(patched).toContain('async function get_hooks() {let websocket;');
    expect(patched).toContain('({ websocket, handle, handleFetch');
    expect(patched).toMatch(/return {\s*websocket,\s*handle,/);

    // the resolved hooks options include it, defaulting to null
    expect(patched).toContain('websocket: module.websocket || null,');

    // the Server class exposes an accessor
    expect(patched).toContain(
      'websocket() {return this.#options.hooks.websocket}'
    );
  });

  test('threads the websocket hook through a Bun.build-bundled server', () => {
    const patched = patched_text(single(with_hooks_bun_build));

    // Bun.build emits a spaced destructure (`({ handle,` with a space)
    expect(patched).toContain('async function get_hooks() {let websocket;');
    expect(patched).toContain('({ websocket, handle, handleFetch');
    expect(patched).toMatch(/return {\s*websocket,\s*handle,/);
    expect(patched).toContain('websocket: module.websocket || null,');
    expect(patched).toContain(
      'websocket() {return this.#options.hooks.websocket}'
    );
  });

  test('patches across files when get_hooks() lives in a chunk (kit 2.57+)', () => {
    const files = split_fixture();
    const out = patch_server_websocket_handler(files, true);

    // both files needed patching
    expect([...out.keys()].sort()).toEqual(['chunks/internal2.js', 'index.js']);

    const chunk = out.get('chunks/internal2.js')!;
    expect(chunk).toContain('async function get_hooks() {let websocket;');
    expect(chunk).toContain('({ websocket, handle, handleFetch');

    const index = out.get('index.js')!;
    expect(index).toContain('websocket: module.websocket || null,');
    expect(index).toContain(
      'websocket() {return this.#options.hooks.websocket}'
    );
  });

  test('returns only changed files', () => {
    const files = split_fixture();
    files.set('chunks/unrelated.js', 'export const nothing = 1;\n');
    const out = patch_server_websocket_handler(files, true);
    expect(out.has('chunks/unrelated.js')).toBe(false);
  });

  test('leaves unrelated content untouched', () => {
    const patched = patched_text(single(with_hooks));
    expect(patched).toContain('set_read_implementation(wrapped_read);');
    expect(patched).toContain('filter_env(env, env_private_prefix');
  });

  test('patches an app without a hooks.server file (no destructuring step)', () => {
    const patched = patched_text(single(without_hooks), false);

    // the accessor and the null default still land so the runtime can call
    // server.websocket() unconditionally
    expect(patched).toContain('websocket: module.websocket || null,');
    expect(patched).toContain(
      'websocket() {return this.#options.hooks.websocket}'
    );

    // nothing to destructure or return
    expect(patched).not.toContain('({ websocket,');
    expect(patched).not.toMatch(/return {\s*websocket,/);
  });

  test('throws when hooks.server exists but the destructuring is missing', () => {
    expect(() =>
      patch_server_websocket_handler(single(without_hooks), true)
    ).toThrow(/could not destructure websocket/);
  });

  const mutations: [name: string, from: string, to: string][] = [
    [
      'hooks options assignment',
      'this.#options.hooks = {',
      'this.#options.hooksConfig = {',
    ],
    [
      'get_hooks declaration',
      'async function get_hooks() {',
      'async function getHooks() {',
    ],
    ['hooks destructuring', '({handle,', '({handler,'],
    [
      'Server.init signature',
      'async init({ env, read }) {',
      'async init({ env, read, csrf }) {',
    ],
  ];

  for (const [name, from, to] of mutations) {
    test(`fails the build loudly when kit changes the ${name}`, () => {
      const drifted = with_hooks.replace(from, to);
      expect(drifted).not.toBe(with_hooks);
      expect(() =>
        patch_server_websocket_handler(single(drifted), true)
      ).toThrow(/Failed to patch the built SvelteKit server/);
    });
  }
});
