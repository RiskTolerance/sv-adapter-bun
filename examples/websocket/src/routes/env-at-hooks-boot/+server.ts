import { bootEnv } from '../../hooks.server';

export function GET() {
  if (!bootEnv) {
    return new Response('missing ADAPTER_BUN_TEST_SECRET', { status: 500 });
  }

  return new Response(bootEnv);
}
