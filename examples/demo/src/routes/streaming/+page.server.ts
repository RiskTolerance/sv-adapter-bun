// nested promises stream to the client after the shell renders — see
// https://svelte.dev/docs/kit/load#Streaming-with-promises
export function load() {
  return {
    eager: 'shell-ready',
    lazy: new Promise<string>(resolve =>
      setTimeout(() => resolve('LATE_PAYLOAD'), 400)
    ),
  };
}
