# NPM Publishing

Releases happen in GitHub Actions. Do not run `npm publish` locally. The only
exception is the first publish of a new package (see Initial Publish).

## Root Package

The root `poe-code` package is released by `.github/workflows/release.yml`.

Pushing to `main` publishes the `latest` dist tag.

Use `.github/workflows/bump-version.yml` when GitHub should bump and release the
root package. The release workflow runs semantic-release and publishes from
GitHub.

## Workspace Packages

### Scoped Safe Libraries

`@poe-platform/safe-fs`, `@poe-platform/safe-js`, and `@poe-platform/safe-bash` are published in dependency order by
`release-safe.yml`. Their private workspace names remain unchanged. Run
`npm run build`, then `node scripts/package-safe.mjs --out-dir <empty-directory> --version <version>`
to prepare standalone artifacts. SafeFS owns its runtime and declarations;
both other packages depend on the matching SafeFS version. SafeJS filesystem
subpaths remain compatibility re-exports. The private workspace manifests are
not the publish manifests; publish only the generated artifacts.

For a new package's initial publish, use its generated directory
with the terminal-pilot procedure below. Configure all three trusted publishers with
workflow filename `release-safe.yml`, then dispatch that workflow to verify a
subsequent publication with provenance. No npm token is used by that workflow.

### Other Workspaces

Workspace packages use dedicated release workflows, for example
`release-toolcraft.yml`, `release-tokenfill.yml`, and `release-terminal-png.yml`.

Before making a workspace package public:

1. Remove `private: true` from the package manifest.
2. Keep `files: ["dist"]` so source-only files are not published accidentally.
3. Add repository metadata:

   ```json
   {
     "repository": {
       "type": "git",
       "url": "git+https://github.com/poe-platform/poe-code.git",
       "directory": "packages/<package-dir>"
     }
   }
   ```

4. Add or update a release workflow in `.github/workflows/`.
5. Run `npm run lint:packages`.

Release workflows should:

- trigger from `main` with package-specific path filters when possible;
- build the package before publishing;
- publish with `npm publish --provenance --access public`;
- use GitHub OIDC provenance instead of npm tokens.

Required workflow permissions:

```yaml
permissions:
  contents: read
  id-token: write
```

Trusted publishing requires `npm >= 11.5.1` and `node >= 22.14.0`. In
`actions/setup-node`, set the Node version, then upgrade npm before publishing:

```sh
npm install --global npm@^11.5.1
npm publish --provenance --access public
```

## Initial Publish

Trusted publishing cannot create a package that does not exist on npm yet, so
the first version of a new package is published locally:

1. `npm login` (browser + 2FA).
2. From the package directory: `npm publish --access public`. Skip
   `--provenance` — it only works in CI. The 2FA prompt prints a
   `https://www.npmjs.com/auth/cli/...` URL to approve in the browser.
3. Verify with `npm view <package-name>` and a scratch `npm install`.
4. Configure trusted publishing for the package (see Trusted Publishing).
5. All later releases run from GitHub Actions with provenance.

### Automating steps 1–2 with terminal-pilot

Both prompts block on a browser approval, not a code typed back into the
terminal. Run them through the terminal-pilot MCP skill so the link opens
automatically and the assistant can wait for completion instead of relaying
a one-time code:

```
terminal_create_session  command="npm" args=["login"]
terminal_wait_for         pattern="https://www\.npmjs\.com/login"
open "<captured URL>"                          # plain `open`, not a specific browser
terminal_wait_for         pattern="Logged in"
terminal_close_session

terminal_create_session  command="npx" args=["-y","npm@11.5.1","publish","--access","public"] cwd=<package dir>
terminal_wait_for         pattern="https://www\.npmjs\.com/auth/cli"
open "<captured URL>"
terminal_wait_for         pattern="\+ <package-name>@"
terminal_close_session
```

Use `npx npm@11.5.1` for publish (not the locally installed npm) so the
prompt renders the browser-approval flow. Never pass `--otp=<code>` —
approving the link satisfies the OTP check without a code changing hands.

## Trusted Publishing

Configure trusted publishing on npmjs.com for each public package:

- Organization or user: `poe-platform`
- Repository: `poe-code`
- Workflow filename: the workflow that publishes the package
- Environment: leave empty unless the workflow uses one

After that, GitHub Actions can publish with provenance without `NPM_TOKEN` or
`NODE_AUTH_TOKEN`.

## Version Alignment

Package release workflows that publish independent workspace packages should
align with the current npm version before bumping:

```sh
REMOTE=$(npm view <package-name> version 2>/dev/null || echo "0.0.0")
npm version --no-git-tag-version --allow-same-version "$REMOTE"
npm version --no-git-tag-version patch
```

Use `--allow-same-version` so the first workflow run after setup does not fail
when the manifest already matches npm.

## Provenance Failures

If publish fails with an error like:

```text
E422 ... Error verifying sigstore provenance bundle ... package.json: "repository.url" is "", expected to match "https://github.com/poe-platform/poe-code" from provenance
```

Fix the package `repository` metadata. The URL must point to this repo, and
`repository.directory` must point to the workspace package directory.
