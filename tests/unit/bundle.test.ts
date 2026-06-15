import { describe, expect, test } from 'bun:test';
import {
  type BundleConfig,
  type BundleImpls,
  bundle_server,
  is_at_least,
  is_chunk_collision,
  MIN_BUN_VERSION,
} from '../../src/internal/bundle';

describe('is_at_least', () => {
  test('compares semver triples', () => {
    expect(is_at_least('1.3.6', '1.3.6')).toBe(true);
    expect(is_at_least('1.3.7', '1.3.6')).toBe(true);
    expect(is_at_least('1.4.0', '1.3.6')).toBe(true);
    expect(is_at_least('2.0.0', '1.3.6')).toBe(true);
    expect(is_at_least('1.3.5', '1.3.6')).toBe(false);
    expect(is_at_least('1.2.20', '1.3.6')).toBe(false);
    expect(is_at_least('0.9.9', '1.3.6')).toBe(false);
  });

  test('current Bun satisfies the adapter minimum', () => {
    expect(is_at_least(Bun.version, MIN_BUN_VERSION)).toBe(true);
  });
});

describe('is_chunk_collision', () => {
  test('detects the Bun message inside an AggregateError of build logs', () => {
    const err = new AggregateError(
      [{ message: 'Multiple files share the same output path: chunk.js' }],
      'Server bundling failed'
    );
    expect(is_chunk_collision(err)).toBe(true);
  });

  test('detects it on a plain Error message', () => {
    expect(
      is_chunk_collision(new Error('two files share the same output path'))
    ).toBe(true);
  });

  test('follows the cause chain', () => {
    const inner = new Error('share the same output path');
    expect(is_chunk_collision(new Error('wrapped', { cause: inner }))).toBe(
      true
    );
  });

  test('ignores unrelated errors', () => {
    expect(is_chunk_collision(new Error('something else failed'))).toBe(false);
    expect(is_chunk_collision(new AggregateError([], 'failed'))).toBe(false);
    expect(is_chunk_collision(null)).toBe(false);
  });
});

describe('bundle_server bun → rolldown fallback', () => {
  const config: BundleConfig = {
    bundler: 'bun',
    entrypoints: ['x.js'],
    outdir: 'out',
    external_packages: [],
  };

  function spy(opts: { bunFails?: unknown; hasRolldown?: boolean } = {}) {
    const calls: string[] = [];
    const warnings: string[] = [];
    const impls: Partial<BundleImpls> = {
      bun: async () => {
        calls.push('bun');
        if (opts.bunFails) throw opts.bunFails;
      },
      rolldown: async () => {
        calls.push('rolldown');
      },
      hasRolldown: async () => opts.hasRolldown ?? true,
      warn: m => warnings.push(m),
    };
    return { calls, warnings, impls };
  }

  const collision = new AggregateError(
    [{ message: 'Multiple files share the same output path: x.js' }],
    'Server bundling failed'
  );

  test('uses bun and never rolldown on success', async () => {
    const { calls, impls } = spy();
    await bundle_server(config, impls);
    expect(calls).toEqual(['bun']);
  });

  test('falls back to rolldown on a chunk collision when available', async () => {
    const { calls, warnings, impls } = spy({ bunFails: collision });
    await bundle_server(config, impls);
    expect(calls).toEqual(['bun', 'rolldown']);
    expect(warnings[0]).toContain('rolldown');
  });

  test('throws a helpful error on collision when rolldown is absent', async () => {
    const { calls, impls } = spy({ bunFails: collision, hasRolldown: false });
    await expect(bundle_server(config, impls)).rejects.toThrow(
      /bun add -d rolldown/
    );
    expect(calls).toEqual(['bun']);
  });

  test('rethrows non-collision build errors without falling back', async () => {
    const { calls, impls } = spy({
      bunFails: new Error('syntax error in user code'),
    });
    await expect(bundle_server(config, impls)).rejects.toThrow(/syntax error/);
    expect(calls).toEqual(['bun']);
  });

  test('bundler: rolldown skips bun entirely', async () => {
    const { calls, impls } = spy();
    await bundle_server({ ...config, bundler: 'rolldown' }, impls);
    expect(calls).toEqual(['rolldown']);
  });
});
