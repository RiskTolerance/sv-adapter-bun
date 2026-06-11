// Benchmarks Bun.build vs rolldown bundling the same SvelteKit server
// output, through the adapter's own bundle_server(). Run with:
// bun run scripts/bench-bundlers.ts [iterations]
//
// Input is the kit writeServer output left in an example's
// .svelte-kit/adapter-bun directory — build the example first.
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { bundle_server, type Bundler } from '../src/internal/bundle';

const ITERATIONS = Number(process.argv[2]) || 7;
const EXAMPLE = `${import.meta.dir}/../examples/demo`;
const TMP = `${EXAMPLE}/.svelte-kit/adapter-bun`;

if (!existsSync(`${TMP}/index.js`)) {
  console.error(`No kit server output at ${TMP} — run a demo build first.`);
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(`${EXAMPLE}/package.json`, 'utf-8'));
const deps = Object.keys({
  ...pkg.dependencies,
  ...pkg.peerDependencies,
  ...pkg.optionalDependencies,
});
const entrypoints = [`${TMP}/index.js`, `${TMP}/manifest.js`];

function dir_size(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { recursive: true }) as string[]) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isFile()) total += stat.size;
  }
  return total;
}

function bench(bundler: Bundler) {
  return (outdir: string) =>
    bundle_server({ bundler, entrypoints, outdir, external_packages: deps });
}

interface Result {
  name: string;
  times: number[];
  bytes: number;
}

async function run(
  name: string,
  fn: (outdir: string) => Promise<void>
): Promise<Result> {
  const outdir = `/tmp/bench-${name}`;
  // warmup (JIT, napi load, fs caches)
  rmSync(outdir, { recursive: true, force: true });
  await fn(outdir);

  const times: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    rmSync(outdir, { recursive: true, force: true });
    const start = performance.now();
    await fn(outdir);
    times.push(performance.now() - start);
  }
  return { name, times, bytes: dir_size(outdir) };
}

function stats(times: number[]) {
  const sorted = [...times].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  return { median, mean, min: sorted[0]!, max: sorted.at(-1)! };
}

console.log(
  `Bundling ${entrypoints.length} entrypoints from examples/demo, ${ITERATIONS} timed runs each (1 warmup)\n`
);

const results: Result[] = [];
results.push(await run('bun-build', bench('bun')));
results.push(await run('rolldown', bench('rolldown')));

for (const r of results) {
  const s = stats(r.times);
  console.log(
    `${r.name.padEnd(10)} median ${s.median.toFixed(1).padStart(7)}ms  ` +
      `mean ${s.mean.toFixed(1).padStart(7)}ms  ` +
      `min ${s.min.toFixed(1).padStart(7)}ms  ` +
      `max ${s.max.toFixed(1).padStart(7)}ms  ` +
      `output ${(r.bytes / 1024).toFixed(0).padStart(6)} KiB`
  );
}
