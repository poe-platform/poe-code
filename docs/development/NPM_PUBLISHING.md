# Publishing a new package

## 1. First publish (local, one-time)

```sh
cd packages/<package-dir>
bun pm whoami
bun publish --access public
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
2. Auto-bump the patch version from whatever is currently in the registry
3. Publish with `--provenance --access public`

Required permissions: `id-token: write` (for OIDC provenance).

For trusted publishing, avoid token-based registry auth in the workflow:

- Do not set `NODE_AUTH_TOKEN` / `NPM_TOKEN` for the publish job.
- Trusted publishing requires a current Bun release and `node >= 22.14.0`.
- In `actions/setup-node`, set `node-version`, then install Bun before running `bun publish --access public`.

For the version alignment step, use `--allow-same-version` so the workflow does not fail on first run after local initial publish:

```sh
REMOTE=$(bun info <package-name> version 2>/dev/null || echo "0.0.0")
bun pm version "$REMOTE"
bun pm version patch
```

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
