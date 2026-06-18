import { env } from '$env/dynamic/private';
import type { Handle } from '@sveltejs/kit';

export const bootEnv = env.ADAPTER_BUN_TEST_SECRET;

// module-level state shared between the handle hook (imported by kit) and
// the websocket handlers (imported by the adapter) — proves both see the
// same module instance
let upgrade_count = 0;

export const handle: Handle = async ({ event, resolve }) => {
  const { request } = event;
  const url = new URL(request.url);

  if (
    request.headers.get('connection')?.toLowerCase().includes('upgrade') &&
    request.headers.get('upgrade')?.toLowerCase() === 'websocket' &&
    url.pathname.startsWith('/ws')
  ) {
    console.log('upgrading');
    upgrade_count++;
    // We must use the platform.request here
    await event.platform!.server.upgrade(event.platform!.request);
    return new Response(null, { status: 101 });
  }

  return resolve(event);
};

export const websocket: Bun.WebSocketHandler<undefined> = {
  async open(ws) {
    console.log('WebSocket opened');
    // Bun pub/sub: every socket joins the room; publish from other sockets
    // (ws.publish) or from any request handler (event.platform.server.publish)
    ws.subscribe('room');
    ws.send('Slava Ukraїni');
  },
  message(ws, message) {
    console.log('WebSocket message received');
    const text = message.toString();
    if (text.startsWith('broadcast:')) {
      // delivered to every subscriber except the sender
      ws.publish('room', text.slice('broadcast:'.length));
      return;
    }
    if (text === 'upgrade-count') {
      ws.send(`upgrade-count:${upgrade_count}`);
      return;
    }
    ws.send(message);
  },
  close(ws) {
    console.log('WebSocket closed');
    ws.unsubscribe('room');
  },
};
