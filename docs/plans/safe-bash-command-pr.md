# Pr command workspace

Revalidated at remote main `e862cd0569`: the private `safe-bash-command-pr`
workspace already owns pagination, multicolumn layout, headers, parsing and byte
formatting. Safe Bash keeps its public exports and registration. Canonical
arguments, values, errors and lifecycle contracts come from `safe-bash-contracts`;
calendar and I/O helpers remain lower-level private engines. No leaf depends on
Safe Bash and no private workspace is published separately.

Complete the boundary by moving the recorded native byte suite into the command
workspace without changing expected bytes/status/diagnostics. Shell, VFS,
admission, cancellation and device integration suites stay in Safe Bash. Add a
packed public consumer fixture and strict NodeNext declaration probe; keep them
in the maintained smoke/type fixture entrypoints. The ownership test must fail
before the missing fixtures and this plan are added.

Verification: selected maintained workspace build closure; command unit, lint and
type checks; focused Safe Bash pr regression suites; package ownership and
package-lint gates; isolated packed public exports with private packages absent;
Node, browser and workerd conditions, canonical argv/error identities, VFS scripts,
pipes, registration/replacement, cancellation and explicit resource limits.

Preserve current defaults, locale/width profile, page boundaries and pre-allocation
admission. No output/help or CLI design changes are intended. Deliver to remote
main and verify commit ancestry; release publication is a separate step.

The clean unit graph lacked prerequisite builds. A failing graph characterization
confirmed that contracts and engines were absent; the command unit task now
explicitly depends on `^build`, using the maintained dependency declarations.
