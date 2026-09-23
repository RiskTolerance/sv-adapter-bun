# Releasing

Manual release checklist for `@risk-tolerance/svelte-adapter-bun`.

1. CI is green on `main` (including the integration suite).
2. Update the version in `package.json` and add a dated section to
   `CHANGELOG.md`; commit.
3. Build and inspect the package:

   ```bash
   bun install --frozen-lockfile
   bun run build
   npm pack --dry-run
   ```

   The file list should contain only `dist/`, `index.d.ts`, `ambient.d.ts`,
   `README.md`, `LICENSE` and `package.json`.

4. Confirm you are logged in to npm (`npm whoami`) and a member of the
   `risk-tolerance` npm account (scope matches the username).
5. Publish (`publishConfig.access` is already `public`):

   ```bash
   npm publish
   ```

6. Tag and push:

   ```bash
   git tag v<version>
   git push --tags
   ```

7. Create a GitHub release for the tag with the CHANGELOG section as the
   body.

## Prereleases (`next` branch, SvelteKit 3)

The `next` branch carries the 2.x line for `@sveltejs/kit@next`. Bump with a
prerelease version (`2.0.0-next.N`) and **always** publish with the `next`
dist-tag so `latest` keeps pointing at the SvelteKit 2 release:

```bash
npm publish --tag next --otp=<code>
```

Fixes that apply to both lines land on `main` first and are then merged or
cherry-picked into `next`.
