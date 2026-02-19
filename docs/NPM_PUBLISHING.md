# Publishing a new npm package

## 1. First publish (local, one-time)

```sh
cd packages/<package-dir>
npm login
npm publish --access public
```

## 2. Configure provenance on npmjs.com

Go to `https://www.npmjs.com/package/<package-name>/access` and add a trusted publisher:

- **Organization or user:** `poe-platform`
- **Repository:** `poe-code`
- **Workflow filename:** the workflow file that publishes the package (e.g. `release-<name>.yml`)

After this, GitHub Actions can publish new versions using OIDC provenance — no tokens needed.

## 3. Create a release workflow

Add a workflow in `.github/workflows/` that triggers on push to `main` with a path filter for the package directory. The workflow should:

1. Build the package
2. Auto-bump the patch version from whatever is currently on npm
3. Publish with `--provenance --access public`

Required permissions: `id-token: write` (for OIDC provenance).

For trusted publishing, avoid token-based npm auth in the workflow:

- Do not set `NODE_AUTH_TOKEN` / `NPM_TOKEN` for the publish job.
- Trusted publishing requires `npm >= 11.5.1` and `node >= 22.14.0`.
- In `actions/setup-node`, set `node-version`, then upgrade npm (example: `npm install --global npm@^11.5.1`) before running `npm publish --provenance --access public`.

For the version alignment step, use `--allow-same-version` so the workflow does not fail on first run after local initial publish:

```sh
REMOTE=$(npm view <package-name> version 2>/dev/null || echo "0.0.0")
npm version --no-git-tag-version --allow-same-version "$REMOTE"
npm version --no-git-tag-version patch
```

## 4. Releasing new versions

Just merge your changes to `main`. The workflow auto-bumps the patch version and publishes — no manual version bumps needed.
