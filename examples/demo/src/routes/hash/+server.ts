// Deliberately imports a Node built-in WITHOUT the node: prefix — this
// exercises the adapter's rolldown externals handling for unprefixed
// built-ins (upstream issues #80/#85).
import { createHash } from 'crypto';
import { json } from '@sveltejs/kit';

export function GET() {
  return json({
    hash: createHash('sha256').update('svelte-adapter-bun').digest('hex'),
  });
}
