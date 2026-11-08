# Tree command ownership

The private `safe-bash-command-tree` workspace owns traversal, sorting, filtering,
text/JSON rendering, limits and synchronous evaluation. Safe Bash retains its
public root/subpath exports and default registration; consumers use only
`@poe-platform/safe-bash`. No standalone publication or external runtime dependency.

Current-main audit: extraction arrived in `b9634cd075`, with admission fixes in
`f8ddf79ce7` and subsequent symlink, locale and cancellation fixes preserved.
The package imports canonical contracts and the existing byte/I/O engines;
there is no dependency back to Safe Bash. Generic packaging bundles private code
and rewrites declarations for Node, browser and workerd.

Finish the ownership boundary by moving report-count regressions unchanged into
the command workspace. Keep Shell/backend integration tests in Safe Bash. Add
packed public-consumer coverage for sorting, links, JSON/text, VFS scripts/pipes,
canonical arguments/errors, cancellation, registration and explicit limits.

Verification: run the selected workspace dependency build, command unit/type/lint
checks, retained Tree integration suites, package boundary/package-lint gates,
and isolated tarball runtime plus strict NodeNext consumers. Exercise portable
conditions without host capabilities. Preserve output bytes and default limits.

Completed verification: the ownership regression failed before the move; all
moved fixtures/assertions are byte-for-byte unchanged. The uncached selected build
and maintained unit route pass (18 tests); eight retained integration suites pass
(152 tests). Package/boundary suites pass (285 tests), as do command lint and strict
types, public declaration-isolation tests and six applicable source package gates.
The shipping parent and companion build and generic packer pass. An external
consumer installed only the three existing public tarballs and passed the tree
runtime fixture, strict NodeNext declarations and browser/workerd bundles in a
realm without host filesystem/process/network or global Buffer. No production
output/help changes were needed, so screenshot validation is not applicable.
