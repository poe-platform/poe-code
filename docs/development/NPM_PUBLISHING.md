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
- **Environment:** leave empty

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

For a single-package release, the workflow can align to the current npm version and patch from there. Use `--allow-same-version` so the workflow does not fail on first run after local initial publish:

```sh
REMOTE=$(npm view <package-name> version 2>/dev/null || echo "0.0.0")
npm version --no-git-tag-version --allow-same-version "$REMOTE"
npm version --no-git-tag-version patch
```

For packages that must release in lockstep, use the shared composite action after calculating the concrete version and before packing/publishing any package in the group:

```yaml
- name: Prepare lockstep package versions
  uses: ./.github/actions/prepare-lockstep-release
  with:
    version: ${{ steps.version.outputs.version }}
    packages: '["packages/toolcraft-schema", "packages/toolcraft", "packages/toolcraft-openapi"]'
```

The action rewrites every listed `package.json` to the same version and rewrites intra-group `dependencies`, `peerDependencies`, and `optionalDependencies` to that exact version. The group must contain at least two public npm package directories, and each prepared package should be published by the workflow. The Toolcraft release group publishes `toolcraft-schema`, `toolcraft`, and `toolcraft-openapi`; `toolcraft-design` is private and is bundled through the public `toolcraft/design` export, so the workflow builds it but does not prepare or publish it. `npm run lint:packages` enforces public lockstep groups with `lockstep-release-group-valid`.

If a published package declares `bin`, add the shared executable-bit helper to `prepack` so `tsc`-emitted binaries do not ship as mode `0644`:

```json
{
  "scripts": {
    "prepack": "npm run build && node ../../scripts/set-bin-executable.mjs"
  }
}
```

The helper derives targets from the package `bin` field, fails when a declared bin file is missing, and writes progress to stderr so `npm pack --json` output stays valid JSON.

## 4. Provenance troubleshooting

If publish fails with an error like:

`E422 ... Error verifying sigstore provenance bundle ... package.json: "repository.url" is "", expected to match "https://github.com/poe-platform/poe-code" from provenance`

Then make sure the package `package.json` includes repository metadata that points to this repo:

```json
{
  "repository": {
    "type": "git",
    "url": "git+https://github.com/poe-platform/poe-code.git",
    "directory": "packages/<package-dir>"
  }
}
```

## 5. Releasing new versions

Just merge your changes to `main`. The workflow auto-bumps the patch version and publishes — no manual version bumps needed.
