import { expect } from 'bun:test';

const ROOT = new URL('../..', import.meta.url).pathname;

export const DEMO_DIR = `${ROOT}examples/demo`;
export const WEBSOCKET_DIR = `${ROOT}examples/websocket`;

export interface RunningServer {
  proc: Bun.Subprocess;
  baseUrl: string;
}

function run(cmd: string[], cwd: string) {
  const result = Bun.spawnSync(cmd, {
    cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (result.exitCode !== 0) {
    console.error(`${cmd.join(' ')} in ${cwd} exited with`, {
      exitCode: result.exitCode,
      signalCode: result.signalCode,
    });
    console.error(result.stdout.toString());
    console.error(result.stderr.toString());
  }
  expect(result.exitCode).toBe(0);
}

/**
 * Builds the adapter dist/ and then installs + builds an example app.
 * The examples consume the adapter through bun's link: protocol, so the
 * package name must be registered (bun link) and the adapter dist/ built
 * before the example installs — its export map points at dist/.
 */
export function buildExample(dir: string) {
  run(['bun', 'link'], ROOT);
  run(['bun', 'run', 'build'], ROOT);
  run(['bun', 'install'], dir);
  run(['bun', 'run', 'build'], dir);
}

export async function startServer(
  dir: string,
  env: Record<string, string> = {}
): Promise<RunningServer> {
  const port = 20000 + Math.floor(Math.random() * 40000);
  const baseUrl = `http://127.0.0.1:${port}`;

  const proc = Bun.spawn(['bun', 'build/index.js'], {
    cwd: dir,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      await fetch(baseUrl, { method: 'HEAD' });
      return { proc, baseUrl };
    } catch {
      await Bun.sleep(150);
    }
  }

  proc.kill();
  throw new Error(`Server in ${dir} did not start listening on ${baseUrl}`);
}

export async function stopServer(server: RunningServer | undefined) {
  if (!server) return;
  server.proc.kill();
  await server.proc.exited;
}
