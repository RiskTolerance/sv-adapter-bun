export interface OriginConfig {
  protocol_header: string;
  host_header: string;
  port_header: string;
}

/**
 * Builds the request origin from forwarded headers, validating each value so
 * a client cannot smuggle an attacker-controlled origin. Port of the
 * adapter-node hardening from sveltejs/kit@d9ae9b0, adapted to fetch Headers
 * semantics: get() returns string|null and duplicate headers arrive
 * comma-joined, so multi-value smuggling shows up as ',' in the value.
 */
export function get_origin(headers: Headers, config: OriginConfig): string {
  const { protocol_header, host_header, port_header } = config;

  let protocol = 'https';
  if (protocol_header && headers.get(protocol_header)) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(headers.get(protocol_header)!);
    } catch {
      throw new Error(
        `The ${protocol_header} header contains a malformed percent-encoding and could not be decoded`
      );
    }

    // a scheme charset check subsumes kit's ':' check and also rejects
    // comma-joined duplicate headers and whitespace
    if (!/^[a-z][a-z0-9+\-.]*$/i.test(decoded)) {
      throw new Error(
        `The ${protocol_header} header specified ${decoded} which is invalid. It should only contain the protocol scheme (e.g. 'https')`
      );
    }

    protocol = decoded;
  }

  const forwarded_host = host_header && headers.get(host_header);
  const host = forwarded_host || headers.get('host');
  if (!host) {
    const header_names = host_header
      ? `${host_header} or host headers`
      : 'host header';
    throw new Error(
      `Could not determine host. The request must have a value provided by the ${header_names}`
    );
  }

  // stricter than adapter-node, which silently builds a garbage origin from
  // comma-joined duplicate host headers
  if (host.includes(',')) {
    throw new Error(
      `The ${forwarded_host ? host_header : 'host'} header contains multiple values: ${host}`
    );
  }

  const port = port_header && headers.get(port_header);
  if (port && isNaN(+port)) {
    throw new Error(
      `The ${port_header} header specified ${port} which is invalid because it is not a number. The value should only contain the port number (e.g. 443)`
    );
  }

  return port ? `${protocol}://${host}:${port}` : `${protocol}://${host}`;
}
