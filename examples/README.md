# Examples

## Available Examples

- [Demo](./demo/) - Full SvelteKit application
- [WebSocket](./websocket/) - WebSocket server example
- [Nginx](./nginx/) - Production deployment with Nginx reverse proxy

## Quick Start

The examples consume the adapter from this repository through bun's `link:`
protocol, so register and build the adapter once first:

```bash
# from the repository root
bun install
bun link
bun run build
```

Then install and build an example:

```bash
cd examples/[example-name]
bun install
bun -b run build
```
