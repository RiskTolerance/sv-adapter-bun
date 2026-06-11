import { describe, expect, test } from 'bun:test';
import { get_origin } from '../../src/internal/origin';

const no_headers = { protocol_header: '', host_header: '', port_header: '' };
const forwarded = {
  protocol_header: 'x-forwarded-proto',
  host_header: 'x-forwarded-host',
  port_header: 'x-forwarded-port',
};

describe('get_origin', () => {
  test('defaults to https and the host header', () => {
    const headers = new Headers({ host: 'example.com' });
    expect(get_origin(headers, no_headers)).toBe('https://example.com');
  });

  test('uses configured forwarded headers', () => {
    const headers = new Headers({
      host: 'internal:3000',
      'x-forwarded-proto': 'http',
      'x-forwarded-host': 'example.com',
    });
    expect(get_origin(headers, forwarded)).toBe('http://example.com');
  });

  test('appends a forwarded port', () => {
    const headers = new Headers({
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'example.com',
      'x-forwarded-port': '8443',
    });
    expect(get_origin(headers, forwarded)).toBe('https://example.com:8443');
  });

  test('falls back to the host header when the forwarded host is absent', () => {
    const headers = new Headers({
      host: 'example.com',
      'x-forwarded-proto': 'https',
    });
    expect(get_origin(headers, forwarded)).toBe('https://example.com');
  });

  describe('protocol validation', () => {
    test('rejects a protocol containing a colon', () => {
      const headers = new Headers({
        host: 'example.com',
        'x-forwarded-proto': 'https://evil.example',
      });
      expect(() => get_origin(headers, forwarded)).toThrow(/x-forwarded-proto/);
    });

    test('rejects a percent-encoded colon', () => {
      const headers = new Headers({
        host: 'example.com',
        'x-forwarded-proto': 'https%3A//evil.example',
      });
      expect(() => get_origin(headers, forwarded)).toThrow(/x-forwarded-proto/);
    });

    test('rejects malformed percent sequences', () => {
      const headers = new Headers({
        host: 'example.com',
        'x-forwarded-proto': 'https%ZZ',
      });
      expect(() => get_origin(headers, forwarded)).toThrow(/x-forwarded-proto/);
    });

    test('rejects comma-joined duplicate protocol headers', () => {
      const headers = new Headers({ host: 'example.com' });
      headers.append('x-forwarded-proto', 'https');
      headers.append('x-forwarded-proto', 'http');
      expect(() => get_origin(headers, forwarded)).toThrow(/x-forwarded-proto/);
    });
  });

  describe('host validation', () => {
    test('throws when no host can be determined', () => {
      const headers = new Headers();
      expect(() => get_origin(headers, no_headers)).toThrow(
        /Could not determine host/
      );
    });

    test('rejects comma-joined duplicate host headers', () => {
      const headers = new Headers({ host: 'example.com' });
      headers.append('x-forwarded-host', 'example.com');
      headers.append('x-forwarded-host', 'evil.example');
      expect(() => get_origin(headers, forwarded)).toThrow(/x-forwarded-host/);
    });
  });

  describe('port validation', () => {
    test('rejects a non-numeric port', () => {
      const headers = new Headers({
        host: 'example.com',
        'x-forwarded-port': '8443garbage',
      });
      expect(() => get_origin(headers, forwarded)).toThrow(/x-forwarded-port/);
    });

    test('rejects comma-joined duplicate port headers', () => {
      const headers = new Headers({ host: 'example.com' });
      headers.append('x-forwarded-port', '443');
      headers.append('x-forwarded-port', '443');
      expect(() => get_origin(headers, forwarded)).toThrow(/x-forwarded-port/);
    });
  });
});
