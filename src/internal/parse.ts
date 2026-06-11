/**
 * Parses the given value into number of bytes.
 *
 * @param {string} value - Size in bytes. Can also be specified with a unit suffix kilobytes (K), megabytes (M), or gigabytes (G).
 * @returns {number}
 */
/**
 * Parses an idle timeout in seconds. Bun.serve caps idleTimeout at 255 and
 * treats 0 as "disabled", so anything outside 0–255 (or non-integer) is
 * rejected with NaN for the caller to turn into a startup error.
 */
export function parse_idle_timeout(value: string): number {
  if (value.trim() === '') return NaN;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 255) {
    return NaN;
  }
  return parsed;
}

export function parse_as_bytes(value: string): number {
  const units = value.at(-1)?.toUpperCase();
  const multiplier = {
    B: 1,
    K: 1024,
    M: 1024 * 1024,
    G: 1024 * 1024 * 1024,
  }[units ?? ''];
  const numeric = multiplier !== undefined ? value.slice(0, -1) : value;
  return numeric === '' ? NaN : Number(numeric) * (multiplier ?? 1);
}
