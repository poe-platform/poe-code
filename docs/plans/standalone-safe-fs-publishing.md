# Standalone SafeFS — issue #533

Publish `@poe-platform/safe-fs` with its own runtime and declarations, portable
core, and Node adapter. Keep private workspace names unchanged. Filesystem
consumers must not install SafeJS, Safe Bash, or the CLI.

Rebuild the scoped SafeJS artifact with SafeFS external, and make both scoped
libraries resolve the matching canonical SafeFS version. Preserve existing
SafeJS filesystem subpaths as re-exports. Do not change shell commands.

Document the legacy CLI's separate runtime and the existing `toFsError` adapter
boundary. Verify canonical types and constructors across scoped consumers,
legacy error normalization, standalone install isolation, Node/Bun execution,
and a browser Worker without Node builtins or globals.

Use memory-only packaging unit tests before implementation and real tarball
consumer checks before publishing. Bootstrap only the new package through
terminal-pilot, configure its `release-safe.yml` trusted publisher, then publish
all three packages in dependency order through GitHub OIDC with provenance.
