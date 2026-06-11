/**
 * Parses the given value into number of bytes.
 *
 * @param {string} value - Size in bytes. Can also be specified with a unit suffix kilobytes (K), megabytes (M), or gigabytes (G).
 * @returns {number}
 */
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
