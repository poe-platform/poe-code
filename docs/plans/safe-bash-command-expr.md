# Expr command workspace

The private `safe-bash-command-expr` workspace owns expression parsing, integer
and string evaluation, command limits, factories and registration. Safe Bash
retains its public root and `commands/expr` exports and default inventory. Shared
BRE execution belongs to the private `safe-bash-regex-engine`; canonical command,
value and error identities belong to `safe-bash-contracts`. Neither leaf depends
on Safe Bash. No workspace introduced by this extraction is published separately.

Source revalidation began at remote main `db14d86ca6e9f79df346ab69ec7e96317b20bbbc`.
The implementation and manifest/build admission already existed there. Remaining
work was command-owned grammar regression coverage, canonical byte operand
handling, and explicit packed distribution verification. The byte regression
failed before the fix: operand `ff` became `efbfbd`, and a one-byte argument
incorrectly exceeded `maxArgumentBytes: 1`.

Implementation preserves positional operand identity through the canonical
carrier. Active byte operands are copied only after allocation admission;
inactive operands remain unevaluated. String-only callers retain their existing
encoding and validation path. Grammar cases move unchanged into the command
workspace; Shell, Node worker and lifecycle tests remain integration tests in
Safe Bash. Shared regex and runtime implementations are not duplicated.

Validation requirements:

- Build the maintained expr and Safe Bash workspace closures.
- Run command unit/lint/type checks, existing expr and bounded-provider integration
  tests, packaging memfs tests and package-lint gates.
- Run `safe-packages-expr.mjs` from an isolated packed consumer and compile
  `safe-packages-expr-types.mts` with strict NodeNext resolution. Private workspace
  imports must be absent from the installed consumer.
- Run the portable fixture with browser/workerd conditions in a realm with no
  host filesystem, process or network. Exercise canonical byte argv, pipes,
  saved VFS scripts, registration/replacement, errors, cancellation and limits.
- Deliver committed changes to remote main and verify ancestry before closure.
  Release publication is separate and is not required for this task.

No help, CLI layout, command inventory, optional capability, external runtime
library or release job changes are intended.
