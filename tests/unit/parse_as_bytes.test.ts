import { describe, expect, test } from 'bun:test';
import { parse_as_bytes } from '../../src/internal/parse';

describe('parse_as_bytes', () => {
  test('parses kilobytes', () => {
    expect(parse_as_bytes('512K')).toBe(512 * 1024);
  });

  test('parses megabytes', () => {
    expect(parse_as_bytes('1M')).toBe(1024 * 1024);
  });

  test('parses gigabytes', () => {
    expect(parse_as_bytes('1G')).toBe(1024 * 1024 * 1024);
  });

  test('parses bare numbers as bytes', () => {
    expect(parse_as_bytes('100')).toBe(100);
  });

  test('parses explicit B suffix', () => {
    expect(parse_as_bytes('100B')).toBe(100);
  });

  test('accepts lowercase suffixes', () => {
    expect(parse_as_bytes('1k')).toBe(1024);
  });

  test('parses Infinity', () => {
    expect(parse_as_bytes('Infinity')).toBe(Infinity);
  });

  test('returns NaN for non-numeric input', () => {
    expect(parse_as_bytes('abc')).toBeNaN();
  });

  test('returns NaN for a bare suffix', () => {
    expect(parse_as_bytes('K')).toBeNaN();
  });
});
