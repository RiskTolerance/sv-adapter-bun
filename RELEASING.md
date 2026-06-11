# Releasing

Manual release checklist for `@risktolerance/svelte-adapter-bun`.

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
   `@risktolerance` scope.
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
