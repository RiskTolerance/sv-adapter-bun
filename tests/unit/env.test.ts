import { describe, expect, test } from 'bun:test';
import { check_env_conflicts, create_env } from '../../src/internal/env';

describe('create_env', () => {
  test('returns the value of an unprefixed variable', () => {
    const env = create_env('', { PORT: '4000' });
    expect(env('PORT', '3000')).toBe('4000');
  });

  test('returns the fallback when the variable is missing', () => {
    const env = create_env('', {});
    expect(env('PORT', '3000')).toBe('3000');
  });

  test('looks up prefixed variables', () => {
    const env = create_env('MY_', { MY_PORT: '4000', PORT: '5000' });
    expect(env('PORT', '3000')).toBe('4000');
  });

  test('returns an empty string value rather than the fallback', () => {
    const env = create_env('', { ORIGIN: '' });
    expect(env('ORIGIN', 'fallback')).toBe('');
  });
});

describe('check_env_conflicts', () => {
  test('does nothing without a prefix', () => {
    expect(() => check_env_conflicts('', { WHATEVER: '1' })).not.toThrow();
  });

  test('accepts expected prefixed variables', () => {
    expect(() =>
      check_env_conflicts('MY_', { MY_PORT: '4000', MY_HOST: '0.0.0.0' })
    ).not.toThrow();
  });

  test('ignores unprefixed variables', () => {
    expect(() => check_env_conflicts('MY_', { OTHER: '1' })).not.toThrow();
  });

  test('throws on unexpected prefixed variables', () => {
    expect(() => check_env_conflicts('MY_', { MY_SECRET: 'x' })).toThrow(
      /envPrefix/
    );
  });
});
