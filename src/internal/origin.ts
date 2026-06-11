export interface OriginConfig {
  protocol_header: string;
  host_header: string;
  port_header: string;
}

export function get_origin(headers: Headers, config: OriginConfig): string {
  const { protocol_header, host_header, port_header } = config;

  const protocol = (protocol_header && headers.get(protocol_header)) || 'https';
  const host = (host_header && headers.get(host_header)) || headers.get('host');
  const port = port_header && headers.get(port_header);

  return port ? `${protocol}://${host}:${port}` : `${protocol}://${host}`;
}
