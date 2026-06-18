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

describe('bundle_server primary → fallback order', () => {
  const config: BundleConfig = {
    bundler: 'rolldown',
    entrypoints: ['x.js'],
    outdir: 'out',
    external_packages: [],
  };

  function spy(
    opts: {
      bunFails?: unknown;
      rolldownFails?: unknown;
    } = {}
  ) {
    const calls: string[] = [];
    const warnings: string[] = [];
    const impls: Partial<BundleImpls> = {
      bun: async () => {
        calls.push('bun');
        if (opts.bunFails) throw opts.bunFails;
      },
      rolldown: async () => {
        calls.push('rolldown');
        if (opts.rolldownFails) throw opts.rolldownFails;
      },
      warn: m => warnings.push(m),
    };
    return { calls, warnings, impls };
  }

  const collision = new AggregateError(
    [{ message: 'Multiple files share the same output path: x.js' }],
    'Server bundling failed'
  );

  test('uses rolldown and never bun on success', async () => {
    const { calls, impls } = spy();
    await bundle_server(config, impls);
    expect(calls).toEqual(['rolldown']);
  });

  test('falls back to bun and warns when rolldown fails', async () => {
    const { calls, warnings, impls } = spy({
      rolldownFails: new Error('rolldown crashed'),
    });
    await bundle_server(config, impls);
    expect(calls).toEqual(['rolldown', 'bun']);
    expect(warnings[0]).toContain('rolldown failed');
    expect(warnings[0]).toContain('Bun.build');
  });

  test('throws a combined error when rolldown and bun both fail', async () => {
    const { calls, impls } = spy({
      rolldownFails: new Error('rolldown crashed'),
      bunFails: new Error('bun crashed'),
    });
    await expect(bundle_server(config, impls)).rejects.toThrow(
      /rolldown failed and fallback Bun\.build failed/
    );
    expect(calls).toEqual(['rolldown', 'bun']);
  });

  test('bundler: bun uses bun and never rolldown on success', async () => {
    const { calls, impls } = spy();
    await bundle_server({ ...config, bundler: 'bun' }, impls);
    expect(calls).toEqual(['bun']);
  });

  test('bundler: bun falls back to rolldown and warns when bun fails', async () => {
    const { calls, warnings, impls } = spy({ bunFails: collision });
    await bundle_server({ ...config, bundler: 'bun' }, impls);
    expect(calls).toEqual(['bun', 'rolldown']);
    expect(warnings[0]).toContain('Bun.build failed');
    expect(warnings[0]).toContain('rolldown');
  });

  test('bundler: bun throws a combined error when bun and rolldown both fail', async () => {
    const { calls, impls } = spy({
      bunFails: new Error('bun crashed'),
      rolldownFails: new Error('rolldown crashed'),
    });
    await expect(
      bundle_server({ ...config, bundler: 'bun' }, impls)
    ).rejects.toThrow(/Bun\.build failed and fallback rolldown failed/);
    expect(calls).toEqual(['bun', 'rolldown']);
  });
});
