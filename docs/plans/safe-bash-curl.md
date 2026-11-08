# Curl command workspace

## Ownership and compatibility

Baseline `e29dfccd3e` already contains the private curl command workspace and portable admission. The remaining extraction moves curl argument/config parsing into that workspace and the common HTTP transfer executor into `safe-bash-network-engine`. Wget depends on the shared engine rather than curl. Shared request bodies, URL expansion, downloads, deadlines, authorization, and credential handling stay below both consumers. Canonical runtime contracts remain in `safe-bash-contracts`.

Existing root network-family aliases, curl-only subpath exports, default inventories, limits, injected transports, and error identity remain unchanged. Safe Bash network source modules remain compatibility re-exports. All command/engine workspaces remain private; the existing parent bundles their implementation and declarations. No external runtime dependency or publication job is added.

## Verification plan

- Reproduce the incorrect dependency direction with the maintained command-workspace boundary test before refactoring.
- Move parser and multipart regressions without weakening assertions; retain Shell integration coverage in Safe Bash.
- Run maintained curl, wget and engine build/unit/lint routes; run focused Safe Bash network regressions and package-lint gates.
- Build the Safe Bash shipping closure and use the maintained packager to create isolated consumer artifacts. Verify public imports, strict NodeNext declarations, Shell scripts/pipes, binary arguments, cancellation, authorization and registration under Node and portable conditions without private workspace packages.
- Review and commit only this change, rebase on current remote main, push and verify ancestry before closing the task. No release wait is required.

## Completed verification

The dependency-boundary characterization failed before the refactor and passed afterward. Fresh maintained curl/wget/network-engine unit checks and source/test lint/type checks passed. The maintained Safe Bash network selection passed all 1,426 tests, with no skips; packaging unit coverage passed 224 tests, and the merged workspace boundary suite passed 91 tests. Package-lint passed all 17 applicable rules (its two build-view-only rules were not reported by that route).

The maintained packager produced tarballs of the existing public parents. An external consumer installed those tarballs and verified public curl/root imports, canonical argument/value/error identities, VFS binary uploads, scripts/pipes, registration/replacement, cancellation, and output/body-mode regressions. Strict NodeNext public declarations passed. No private workspace package was installed or resolvable. Browser and workerd-condition bundles passed in isolated realms with standard web globals and explicit packaged WASM loading, without process, global Buffer, host imports or ambient network. This is portable bundle verification, not a deployed Cloudflare release.

The transfer implementation was compared with its baseline and differs only in import relocation and extraction of the curl factory. Public output/help is unchanged. The rebase retained concurrent command boundary tests and did not alter the tested curl/wget/network source.
