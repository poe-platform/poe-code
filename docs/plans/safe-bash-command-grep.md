# Grep command ownership

Complete the extraction found partially implemented on main `47cf8eff88`.
Move grep matching/output and file selection from the search engine, and alias
helpers from the I/O engine, into the existing private grep workspace. Leave
shared search and regex algorithms below independent grep and rg packages.
Retain Safe Bash adapters, command inventories, plugin replacement policy,
runtime profiles, defaults, and every existing behavior fix.

The ownership test must fail before the move. Move direct pattern-admission
regressions unchanged apart from imports; retain Shell integration tests in
Safe Bash. Run maintained builds, focused workspace tests and lint/type checks,
boundary/packaging tests, and package-lint gates. Verify public packed runtime
and strict NodeNext consumption without private workspace installations,
including scripts, pipelines, aliases, canonical contracts, cancellation,
registration and explicit limits. No output/help changes are intended.

## Verification

The ownership characterization failed before the move and passes afterward.
The grep workspace passes 31 tests, including the moved pattern-admission
suite; alias, rg and shared-search workspaces pass 116 tests. The focused
maintained Shell route passes 808 tests with one optional skip. Packaging and
boundary tests pass 254 checks, and updated discovery passes 53 tests.
Affected workspace lint/type checks and seven package-lint gates pass.

Isolated public parent tarballs pass scripts/pipes, aliases, raw-byte carrier and
value identity, canonical errors, cancellation, registration/replacement and
explicit limits, plus strict NodeNext declarations. No private workspace package
is installed. Browser and workerd bundles pass the same runtime fixture in
realms with standard web APIs and without Node globals or host/network access.
Output and help are unchanged, so no visual CLI change requires a screenshot.
