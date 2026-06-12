import type { RequestHandler } from '@sveltejs/kit';

// server-side pub/sub: any request handler can publish to websocket topics
// through the Bun server instance on event.platform
export const POST: RequestHandler = async ({ request, platform }) => {
  const message = await request.text();
  platform!.server.publish('room', message);
  return new Response('ok');
};
