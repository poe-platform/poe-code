# Issue 704: bounded find formatting

The reported `find / -maxdepth 1 -type f -printf '%f %s bytes\n'` failed with
an unsupported-expression diagnostic on current main. Add a common formatting
subset using the existing find expression/traversal pipeline, without host
commands or a second query evaluator.

Implementation:

- Compile byte-preserving format arguments before traversal. Treat each format
  as an explicit true-valued action and skip its operand during global option
  preprocessing, including an operand spelled `-depth`.
- Preserve starting-root provenance for `%H` and `%P`; implement documented
  name, size, depth, percent and control/octal formats. `%y` uses the existing
  `-type` physical/logical stat semantics, qualified by VFS tests.
- Apply invocation-wide format, output and work bounds, checkpoint pathname
  scans/copies and format loops, await chunked output, and stop traversal when
  formatting resources are exhausted.
- Document exact support and refusals in `packages/safe-bash/docs/FIND_FORMAT.md`.
  No background job lifecycle or elapsed-budget semantics change belongs here.

Validation evidence:

- Initial ten-test regression file failed against the original parser:
  `/tmp/poe-704-find-red.log`.
- Final four-file command validation passed 109 tests in 2.79s:
  `/tmp/poe-704-find-final.log`. The cohort is find-printf, find-time-delete,
  independent-filesystem and independent-arguments under tests/commands.
- Strict no-emit TypeScript: `/tmp/poe-704-find-types.log`.
- Tests cover the reported listing, multi-root paths, dirname edge cases,
  byte-valued formats, expressions, escapes, unsupported syntax, aggregate
  format/output admission, long-token/path cancellation and blocked output.
- GNU find is unavailable locally. Primary GNU manual name/escape semantics
  and the GNU 4.7 trailing-slash correction inform deterministic fixtures;
  this is not an executable GNU differential run.
- Root selected maintained build `npm run build:workspaces -- --workspace=virtual-bash`;
  its declared closure contains `@poe-code/safe-fs` and `virtual-bash`.
  Final lint, remote delivery and publication remain root-coordinated.

Independent review identified and corrected three implementation concerns:
admit bytes before copying the argument, charge/yield long pathname scans,
and propagate formatting exhaustion out of traversal instead of accumulating
repeated errors. Tests preserve those behaviors.
The final raw-string admission control failed before the fast UTF-16 length
guard (`/tmp/poe-704-find-admission-red.log`) and passes afterward. A long-name
cancellation fixture initially reached the memory filesystem's ENAMETOOLONG
guard before formatting; that control now tests the renderer directly with a
synthetic long display pathname. Its original failure remains in
`/tmp/poe-704-find-path-fixture-red.log`; filesystem validation was not changed.

Root qualification found that the selected two-workspace build alone does not
produce canonical browser/workerd package artifacts. Preserve its incomplete
consumer at `/private/tmp/poe-704-find-public-gms0mwwa`; delivery uses the normal
`npm run build`, including root suffix stages. The subsequently exposed ANSI-C
decoder portability failure is fixed separately in `portable-decoder-errors.md`.

Final validation passed the normal build and 27 packaged cases on each of Node,
Bun, browser bundle and actual workerd, plus three strict type profiles and
bundle graph checks: `/private/tmp/poe-704-decoder-final-n6fvzhig`. Root visually
reviewed that candidate's real find/tar CLI screenshot. Full root lint, types and
workflow checks passed in 351.48 seconds, with 10,512 configured/linted files,
zero errors/warnings and 25 receipts (`/tmp/poe-704-decoder-find-lint.log`).

The other requested documentation alternatives already exist in committed code:
`packages/safe-bash/README.md:254` describes maxCpuMs as elapsed time including
waits; Poe2 base `1a002e8559a4d3db236d560abe615f8b07f5baf5` has model-facing
sequential foreground guidance in `packages/poe-prompting/components/files.ts:43`.
The guidance reaches default-chat through run-assembly and admitted tool gating.
