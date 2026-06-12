interface PatchStep {
  description: string;
  pattern: RegExp;
  replacement: string;
  // only present in the bundle when the app has a hooks.server file
  requires_server_hooks?: boolean;
}

// These regexes rewrite SvelteKit's built server/index.js (after rolldown
// bundling) to thread a `websocket` export from hooks.server through to a
// websocket() accessor on the Server class. They are coupled to the shape of
// kit's internals and rolldown's output formatting.
const steps: PatchStep[] = [
  {
    description:
      'inject the websocket hook into the resolved hooks options object',
    pattern:
      /(const (.*?) = await get_hooks\(\);)\s+(this\.#options\.hooks\s+=\s+{)/,
    replacement: '$1$3websocket: $2.websocket || null,',
  },
  {
    description: 'declare the websocket binding inside get_hooks()',
    pattern: /(async function get_hooks\(\) {)/,
    replacement: '$1let websocket;',
  },
  {
    description:
      'destructure websocket from the hooks module and return it from get_hooks()',
    // tolerates bundler formatting differences: rolldown emitted `({handle,`,
    // Bun.build emits `({ handle,` (and may rename: `({ handle: handle2,`)
    pattern: /\({\s*(handle[,:])((.|\s)*?return {)/,
    replacement: '({ websocket, $1$2websocket,',
    requires_server_hooks: true,
  },
  {
    description: 'expose a websocket() accessor on the Server class',
    pattern: /(async init\({ env, read }\) {)/,
    replacement: 'websocket() {return this.#options.hooks.websocket}\n$1',
  },
];

/**
 * Patches SvelteKit's built server to expose the websocket hook. Operates on
 * the whole emitted file set (index.js plus chunks) because the bundler
 * decides per-app whether get_hooks() lands in the entry or a shared chunk —
 * on kit 2.57+ it commonly splits out. Each pattern is applied to the first
 * file it matches; a pattern matching no file throws so a kit-internals
 * change fails the build loudly instead of silently producing a server
 * without WebSocket support.
 *
 * Apps without a hooks.server file produce a get_hooks() with no module
 * destructuring — `has_server_hooks` tells the patcher whether that step is
 * required or legitimately absent (the websocket() accessor then resolves to
 * null and the runtime starts a plain HTTP server).
 *
 * Returns only the entries that changed, keyed as given.
 */
export function patch_server_websocket_handler(
  files: Map<string, string>,
  has_server_hooks: boolean
): Map<string, string> {
  const contents = new Map(files);
  const changed = new Set<string>();

  for (const step of steps) {
    let matched = false;

    for (const [path, content] of contents) {
      if (step.pattern.test(content)) {
        contents.set(path, content.replace(step.pattern, step.replacement));
        changed.add(path);
        matched = true;
        break;
      }
    }

    if (!matched) {
      if (step.requires_server_hooks && !has_server_hooks) continue;

      throw new Error(
        `Failed to patch the built SvelteKit server for WebSocket support: ` +
          `could not ${step.description} in any server output file ` +
          `(searched ${contents.size}). SvelteKit's internals have likely ` +
          `changed shape. Please report this at ` +
          `https://github.com/RiskTolerance/sv-adapter-bun/issues`
      );
    }
  }

  return new Map([...contents].filter(([path]) => changed.has(path)));
}
