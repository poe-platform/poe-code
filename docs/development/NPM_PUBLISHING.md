# NPM Publishing

Releases happen in GitHub Actions. Do not run `npm publish` locally. The only
exception is the first publish of a new package (see Initial Publish).
That historical exception does **not** apply to the optional Safe Bash
distribution: its bootstrap and releases must use a separately approved
GitHub-only route, with no local publish or token fallback.

## Root Package

The root `poe-code` package is released by `.github/workflows/release.yml`.

Pushing to `main` publishes the `latest` dist tag.

Use `.github/workflows/bump-version.yml` when GitHub should bump and release the
root package. The release workflow runs semantic-release and publishes from
GitHub.

## Workspace Packages

### Scoped Safe Libraries

`@poe-platform/safe-fs`, `@poe-platform/safe-js`, `@poe-platform/safe-bash`, and
the separately installed `@poe-platform/safe-bash-optional` use
`release-safe.yml`. Their private workspace names remain unchanged. Run
`npm run build`, then `node scripts/package-safe.mjs --out-dir <empty-directory> --version <version>`
to prepare standalone artifacts. SafeFS owns its runtime and declarations;
SafeJS and core Safe Bash depend on the matching SafeFS version. SafeJS filesystem
subpaths remain compatibility re-exports. The private workspace manifests are
not the publish manifests; publish only the generated artifacts.

The generator's default remains the original three packages. Its explicit
`--include-optional` flag additionally prepares `safe-bash-optional`; it does
not add optional implementations to the core/root/browser artifacts. The
maintained workspace build discovers the private optional workspace's build
task and orders its canonical core/filesystem dependencies first. The optional
artifact must use the exact same release-version core and filesystem peers.

The workflow verifies four actual tarballs. Before installing the historical
root package or YAML, it installs only core, filesystem and optional tarballs
in a separate consumer with optional dependencies omitted and runs the
no-YAML fixture with Node and Bun. It then installs exactly `yaml@2.9.0` and
runs the optional runtime and strict TypeScript fixtures. A second independent
tarball installation supplies the foreign core graph to the runtime fixture;
a second import spelling within the first graph is not an identity test.
Existing Node/Bun/core/types/browser, historical root coexistence and
filesystem-only consumers remain separate checks.

The next shared version includes all four current registry versions. A real
HTTP 404 is reported as missing external package/bootstrap setup, not as
version zero or evidence of permission; authentication, network, malformed
metadata and other HTTP failures are not treated as absence. The optional
package's README must exist before the workflow proceeds. README permission,
package ownership/bootstrap and trusted-publisher configuration remain external
prerequisites; this workflow does not create or configure them. In particular,
an anonymous 404 does not establish name availability or publishing rights.

After publishing the existing three packages, the workflow verifies each
exact version in the registry before publishing the optional fourth package.
It then verifies that exact optional version, and only then writes a four-package
publication summary. Missing optional publication is a failed workflow, not a
successful three-package substitute. Local builds, passing installed fixtures
and committed workflow changes do not establish a published release.

For the original three packages' initial publish, use the generated directory
with the terminal-pilot procedure below. Configure all three trusted publishers with
workflow filename `release-safe.yml`, then dispatch that workflow to verify a
subsequent publication with provenance. No npm token is used by that workflow.
For the new optional package, do not use that legacy local procedure or assume
OIDC alone can bootstrap the name. Obtain explicit approval for a supported
GitHub-only bootstrap and configure its trusted publisher for this repository
and `release-safe.yml` before enabling publication. No npm settings, registry
state or credentials are changed by the implementation work.

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

This is the historical procedure for other packages, not authorization for
the optional Safe Bash distribution described above.

The legacy procedure used a local first publish before configuring the
package's trusted publisher:

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
set -eu
REMOTE=$(npm view <package-name> version)
npm version --no-git-tag-version --allow-same-version "$REMOTE"
npm version --no-git-tag-version patch
```

Use `--allow-same-version` so the first workflow run after setup does not fail
when the manifest already matches npm.
Do not convert registry failures into version zero. A genuinely absent new
package needs its separately approved bootstrap; an authentication or network
failure must stop version selection.

## Provenance Failures

If publish fails with an error like:

```text
E422 ... Error verifying sigstore provenance bundle ... package.json: "repository.url" is "", expected to match "https://github.com/poe-platform/poe-code" from provenance
```

Fix the package `repository` metadata. The URL must point to this repo, and
`repository.directory` must point to the workspace package directory.
