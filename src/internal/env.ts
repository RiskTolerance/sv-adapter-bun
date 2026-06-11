const expected = new Set([
  'SOCKET_PATH',
  'HOST',
  'PORT',
  'ORIGIN',
  'XFF_DEPTH',
  'ADDRESS_HEADER',
  'PROTOCOL_HEADER',
  'HOST_HEADER',
  'PORT_HEADER',
  'BODY_SIZE_LIMIT',
  'IDLE_TIMEOUT',
]);

export function check_env_conflicts(
  prefix: string,
  env: Record<string, string | undefined>
): void {
  if (!prefix) return;

  for (const name in env) {
    if (name.startsWith(prefix)) {
      const unprefixed = name.slice(prefix.length);
      if (!expected.has(unprefixed)) {
        throw new Error(
          `You should change envPrefix (${prefix}) to avoid conflicts with existing environment variables — unexpectedly saw ${name}`
        );
      }
    }
  }
}

export function create_env(
  prefix: string,
  env: Record<string, string | undefined>
) {
  return (name: string, fallback: any) => {
    const prefixed = prefix + name;
    return prefixed in env ? env[prefixed] : fallback;
  };
}
