# AWK command workspace

Own AWK syntax, runtime, readers, values, retention, inspection and formatting in
`packages/safe-bash-command-awk`. The workspace stays private and is bundled into
Safe Bash; consumers use `@poe-platform/safe-bash/commands/awk`.

The extraction already landed in `9ec52b1650`. Revalidation at `97884e8b22`
confirmed that legacy `text-programs/awk*` modules are compatibility exports.
Shared input and byte/output algorithms belong to `safe-bash-io-engine`, while
regex execution and budgets belong to `safe-bash-regex-engine`. Sed uses these
same leaves. Canonical argument/value/error contracts remain in
`safe-bash-contracts`. No command or engine depends back on Safe Bash.

Preserve default inventories, field/getline/formatting behavior, explicit limits,
and the existing unbounded omitted-limit policy. Keep command-only tests in the
AWK workspace and shell composition regressions in Safe Bash. Do not publish a
standalone command package or add runtime dependencies.

Verification:

- Run the maintained AWK build/unit closure and workspace lint/typecheck.
- Run command boundary/export and packaging checks, plus AWK shell regressions.
- Pack the existing Safe Bash distribution and install it without private
  workspaces. Run the maintained AWK consumer fixture and strict NodeNext
  declaration fixture. Verify VFS scripts/pipes, canonical byte carriers and
  errors, cancellation, registration collisions/replacement and output limits.
- Preserve existing browser/workerd export conditions and exercise the portable
  command fixture through the browser bundle.

The initial missing-workspace characterization was recorded before the extraction;
the current boundary test prevents loss of private admission and adapter ownership.
No CLI output or help behavior changes are intended.

## Verification completed

The maintained build closure, 104 uncached AWK workspace tests, 796 selected
shell regressions, workspace lint/typechecks, 166 command-export tests,
28 boundary tests and 223 packaging tests passed. Seven package-lint gates
passed for AWK, its shared engines/contracts and Safe Bash with no skipped gates.

The parent tarballs passed an isolated consumer with no private workspace
installs: AWK execution, VFS scripts/pipes, canonical argument/value and error
identity, registration/replacement, step limits, cancellation and strict NodeNext
declarations. Browser and workerd bundles executed the command-export fixture
with only bundled WASM assets, standard browser APIs, and denied host/network
access. CLI output and help were unchanged; no screenshot was required.
