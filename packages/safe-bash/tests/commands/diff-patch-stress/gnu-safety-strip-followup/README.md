# Independent safety/strip reconciliation

On August 26, 2026, the two owned pre-existing safety files reproduced 80 passes
and three failures out of 83 tests. These were the author ancestor iteration,
independent ancestor case, and independent file-parent case. No source changes
were needed. Only those three invocations now use `-p0` to retain the parent
whose authorization the rejection assertion was intended to exercise.

## Independent observations

`evidence.ts` preserves each original patch input, files, aliases and cwd, adding
an outside-cwd sentinel. Every native invocation gets a separate temporary
namespace. It uses the existing `gnu-target/oracle.ts` SHA-256/version-checked
GNU patch 2.8 executable, not the platform patch or an unpinned fallback.

| Original case | Default-selected paths | Native/product status | Retained `-p0` path | Native/product status |
| --- | --- | --- | --- | --- |
| Author ancestor | `target` | 0 / 0 | `linkdir/target` | 0 / 2 |
| Independent ancestor | `first`, `target` | 0 / 0 | `first`, `alias/target` | 0 / 2 |
| Independent file-parent | `first`, `child` | 0 / 0 | `first`, `blocker/child` | 1 / 2 |

Default stripping legitimately discards the symlink/file prefix. The three
positive parity controls require exact stdout/status/stderr and the complete
expected namespace, including target bytes and unchanged ignored aliases,
referents, input files, blockers and sentinels. Product mutation calls must be
exactly the selected writes. Identity checks retain inode/device/mode/link-count
checks for ignored objects; only the destination directory's link count is not
required to remain constant when a child is created (the observed native
filesystem increments it). Full raw snapshots still capture that count.

The three separate retained-path controls explicitly test **project safety
policy**, not native parity. GNU follows the retained symlink ancestor and
changes `dir/target`; the product rejects before any mutation. GNU applies
`first` before rejecting `blocker/child`; the product rejects the entire
invocation before any mutation. Both native and product namespaces are asserted.
The original selected-target, dangling-link, hardlink, traversal, cwd-alias,
input-alias and other safety assertions remain in place without relaxation.

## Validation and limits

- Repaired original files plus new controls: **89/89 passed**, including all
  original 83 tests and six additional controls.
- All six old independent safety files, author safety, these six new controls,
  independent GNU auxiliary/candidate tests and author authorization/strip/
  candidate-error followups: **286/286 passed**, strict unhandled rejections,
  zero skips/cancellations/todos.
- Strict scoped TypeScript `--noEmit`: passed. Global `--noEmit`: exit 2,
  six unrelated TS2412 errors in concurrent `src/commands/network/args.ts` at
  lines 92, 93, 99, 101, 102 and 103. No source fixes attempted.
- Source hashes remained unchanged during capture and the 286-test/typecheck
  run. No emitted source JavaScript twins were found. This is not a final
  repository freeze; other workers were active.
- The separately reported 23 pruning failures were not modified, skipped or
  rerun here. Their filesystem-contract blocker remains outside this assignment.
  This scoped result does not declare the full product or full diff/patch gate
  passing, and does not establish superiority over another implementation.

`evidence.json` records exact inputs, selections, outputs, pins, source hashes,
validation counts, global diagnostics and hashes of the full `/tmp` artifacts.
The validation artifact includes the exact expanded commands. Raw namespace
observations can be regenerated without changing committed evidence:

```sh
node --import tsx tests/commands/diff-patch-stress/gnu-safety-strip-followup/capture.ts > /tmp/safe-bash-safety-strip-recapture.json
node --unhandled-rejections=strict --import tsx --test tests/commands/diff-patch-stress/gnu-safety-strip-followup/controls.test.ts
```

An initial new-control run also caught the native destination-directory link
count change on creation. Only that new assertion was corrected; no existing
safety assertion or source was weakened to accommodate it.
