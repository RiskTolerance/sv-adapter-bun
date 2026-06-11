import { describe, expect, test } from 'bun:test';
import { is_at_least, MIN_BUN_VERSION } from '../../src/internal/bundle';

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
