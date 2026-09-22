# command-fmt cleanup and installed export QA

Run against the current working-tree candidate, preserving existing edits.

1. Reproduce pending-metadata cleanup with the independent fmt command and
   adversarial tests. Assert cleanup and Shell disposal settle before metadata
   returns, including falsey cancellation and metadata rejection. Assert no late
   file read, iterator acquisition or output occurs.
2. Run the private command workspace unit and lint routes. Verify typed SDK and
   byte argv parity, literal operands, unknown flags, profiles, resource budgets,
   producer ownership, awaited writes and acquired-resource retirement.
3. Build the maintained selected Safe Bash workspace closure, then rerun fmt,
   adversarial and agent registration integration tests against fresh artifacts.
4. Stage public packages with the maintained package-safe builder, pack only
   SafeFS, SafeJS and SafeBash, and install offline with scripts disabled into an
   isolated consumer. Run the maintained fmt runtime fixture and compile its
   strict NodeNext declaration consumer. Assert private workspaces are absent.
5. Inspect a screenshot of actual Shell-dispatched fmt help and the released
   width8 control. Use the generic maintained screenshot runner because fmt is
   a virtual-shell command rather than a poe-code top-level command.
6. Record passes and open cells separately. Remove task-owned temporary evidence.

Cleanup closes input admission synchronously by aborting the invocation signal.
An outstanding capabilitiesFor query owns no stream and does not delay cleanup;
the handler still observes its eventual settlement. The post-query signal check
prevents late resource acquisition. Already acquired iterators and output
operations remain awaited. The former private test requiring metadata drainage
contradicted independent integration assertions and was corrected to this contract;
it failed before the implementation change.

No shared builder, registry defaults, manifest or formatter algorithm changes
are part of this increment. Runtime browser/workerd cells, full combined GNU
native observations and exact committed-revision qualification remain open.

## Executed results (2026-09-19)

- Red: seven independent integration failures reproduced; the corrected private
  metadata cleanup assertion also failed before the implementation change.
- Green: all 65 private workspace tests, ESLint and source/test typechecks pass.
- Selected maintained Safe Bash build closure passes, including 18 builds.
- Fresh fmt/adversarial/agent registration selection: all 755 cases pass.
  The first run loaded stale command dist and reported 748 passes/seven failures;
  rebuilding the selected closure and repeating the entire selection resolved them.
- Three qualified private-command export-condition tests pass.
- Public-only packed offline installation passes the maintained fmt runtime
  fixture and strict NodeNext declaration consumer. Neither private fmt nor
  contracts is installed. Version: 0.0.0-command-fmt-cleanup.
- Actual Shell fmt help/width8 screenshot inspected: readable and expected bytes.
- Released archive hash verified; released/development fmt.c comparison, fmt
  manual and all five upstream test sources read. Only initialization placement
  differs in fmt.c. This is source evidence, with no host fmt runtime execution.

Repository-wide checks were not run for this command-local increment. Browser,
workerd, Bun and additional upstream native combinations remain unverified.
Original/checkpoint/replay interpreter paths were not changed or requalified.
This is a dirty working-tree qualification, not a frozen commit gate. No new
failure or incomplete execution remains in the selected checks. /out was
read-only; ignored out/command-fmt and an isolated temporary consumer held
task-owned evidence and were purged after inspection.

Qualified edited code SHA256:

- src/command.ts: 3378b58934ae6901e2c67232c0a9a30a3c50ca1a238b98ce56cd15ea00094a6d
- src/command.test.ts: fbb341d3bf1fc5a580aef5d0e6f860d377edac9392160429685e68204c079c04

Both paths are relative to packages/safe-bash-command-fmt.

Local commits: none. Remote-main delivery: none. Releases/publication: none.
