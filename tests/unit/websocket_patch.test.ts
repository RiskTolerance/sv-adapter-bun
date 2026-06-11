import { describe, expect, test } from 'bun:test';
import { patch_server_websocket_handler } from '../../src/internal/websocket_patch';

const with_hooks = await Bun.file(
  new URL('../fixtures/kit-server-unpatched.txt', import.meta.url).pathname
).text();
const without_hooks = await Bun.file(
  new URL('../fixtures/kit-server-unpatched-no-hooks.txt', import.meta.url)
    .pathname
).text();

describe('patch_server_websocket_handler', () => {
  test('threads the websocket hook through the built server', () => {
    const patched = patch_server_websocket_handler(with_hooks, true);

    // get_hooks() declares, destructures and returns websocket
    expect(patched).toContain('async function get_hooks() {let websocket;');
    expect(patched).toContain('({handle,websocket, handleFetch');
    expect(patched).toMatch(/return {\s*websocket,\s*handle,/);

    // the resolved hooks options include it, defaulting to null
    expect(patched).toContain('websocket: module.websocket || null,');

    // the Server class exposes an accessor
    expect(patched).toContain(
      'websocket() {return this.#options.hooks.websocket}'
    );
  });

  test('leaves unrelated content untouched', () => {
    const patched = patch_server_websocket_handler(with_hooks, true);
    expect(patched).toContain('set_read_implementation(wrapped_read);');
    expect(patched).toContain('filter_env(env, env_private_prefix');
  });

  test('patches an app without a hooks.server file (no destructuring step)', () => {
    const patched = patch_server_websocket_handler(without_hooks, false);

    // the accessor and the null default still land so the runtime can call
    // server.websocket() unconditionally
    expect(patched).toContain('websocket: module.websocket || null,');
    expect(patched).toContain(
      'websocket() {return this.#options.hooks.websocket}'
    );

    // nothing to destructure or return
    expect(patched).not.toContain('({handle,websocket,');
    expect(patched).not.toMatch(/return {\s*websocket,/);
  });

  test('throws when hooks.server exists but the destructuring is missing', () => {
    expect(() => patch_server_websocket_handler(without_hooks, true)).toThrow(
      /could not destructure websocket/
    );
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
    ['hooks destructuring', '({handle,', '({ handle,'],
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
      expect(() => patch_server_websocket_handler(drifted, true)).toThrow(
        /Failed to patch the built SvelteKit server/
      );
    });
  }
});
