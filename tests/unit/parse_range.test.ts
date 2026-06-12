import { describe, expect, test } from 'bun:test';
// direct source import — node_modules/sirv is a stale file: copy until reinstall
import { parse_range } from '../../packages/sirv/src/index';

describe('parse_range', () => {
  const size = 100;

  test('plain range', () => {
    expect(parse_range('bytes=0-9', size)).toEqual({
      kind: 'range',
      start: 0,
      end: 9,
    });
  });

  test('single byte (bytes=0-0 historically returned the whole file)', () => {
    expect(parse_range('bytes=0-0', size)).toEqual({
      kind: 'range',
      start: 0,
      end: 0,
    });
  });

  test('open-ended range runs to the last byte', () => {
    expect(parse_range('bytes=90-', size)).toEqual({
      kind: 'range',
      start: 90,
      end: 99,
    });
  });

  test('suffix range returns the LAST n bytes', () => {
    expect(parse_range('bytes=-5', size)).toEqual({
      kind: 'range',
      start: 95,
      end: 99,
    });
  });

  test('suffix range larger than the file clamps to the whole file', () => {
    expect(parse_range('bytes=-500', size)).toEqual({
      kind: 'range',
      start: 0,
      end: 99,
    });
  });

  test('end clamps to the file size', () => {
    expect(parse_range('bytes=10-9999', size)).toEqual({
      kind: 'range',
      start: 10,
      end: 99,
    });
  });

  test('reversed bounds are invalid (ignore header)', () => {
    expect(parse_range('bytes=8-3', size)).toEqual({ kind: 'invalid' });
  });

  test('non-bytes units are invalid (ignore header)', () => {
    expect(parse_range('items=0-5', size)).toEqual({ kind: 'invalid' });
  });

  test('multipart ranges are invalid (ignore header)', () => {
    expect(parse_range('bytes=0-1,5-9', size)).toEqual({ kind: 'invalid' });
  });

  test('bare dash is invalid', () => {
    expect(parse_range('bytes=-', size)).toEqual({ kind: 'invalid' });
  });

  test('start beyond the file is unsatisfiable (416)', () => {
    expect(parse_range('bytes=100-', size)).toEqual({
      kind: 'unsatisfiable',
    });
  });

  test('zero-length suffix is unsatisfiable', () => {
    expect(parse_range('bytes=-0', size)).toEqual({ kind: 'unsatisfiable' });
  });

  test('any range into an empty file is unsatisfiable', () => {
    expect(parse_range('bytes=0-', 0)).toEqual({ kind: 'unsatisfiable' });
    expect(parse_range('bytes=-5', 0)).toEqual({ kind: 'unsatisfiable' });
  });
});
