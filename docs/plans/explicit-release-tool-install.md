# Explicit release-tool installation

The release log warns that bare `npx semantic-release` implicitly installs an
unlisted tool. Keep the existing ephemeral release-tool installation, but request
the exact 25.0.9 version already used by the successful September 1 runs and
explicitly approve that installation with `--yes`. This avoids an implicit
latest-version resolution and unattended installation prompt without lowering
logging levels or adding release tooling to product dependencies.

Registry metadata confirms 25.0.9 supports the existing Node 22 runner. Verify the
version-only command (never publish locally) and run `npm run lint:workflows`.
Do not change concurrency, release ordering, permissions, publishing behavior,
or workflow test coverage.

Workflow lint passes. The version-only invocation exits zero without an install
warning; upstream prints `unknown`, so verify the resolved executable's package
manifest independently: it is semantic-release 25.0.9 in npm's explicit-package
cache. No local release command or publication is performed.
