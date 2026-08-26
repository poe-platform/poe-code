# Empty-only pruning consumer checkpoint

This is a separately invoked consumer regression suite, not a revision to the
original acceptance tests. The root release marker was read before any owned
source/test/document write. The revised expectation author had closed at
`c623665`; this leaf does not edit or rerun that worker's revised96 cohort.

## API and source scope

- Curie's `1dc0652` adds optional
  `FileSystem.rmdir(path: string, options?: FsOptions): Promise<void>`.
- Poincare's local/wrapper source checkpoint is `3a9177a`; the remote
  rejection-only implementation is `e13c2d4`.
- This leaf changes only `patch-gnu-paths.ts`, its owned command documentation,
  and this new test directory. It changes no FS/contracts/core/root file.
- The consumer retains the existing path authorization, ancestor selection and
  component-by-component symlink/type inspection. Relative operands stop before
  cwd, explicit absolute operands stop before virtual `/`.
- A nonempty listing needs no removal operation. For an empty listing the
  consumer calls the actual optional method, with its receiver and `signal`.
  The backend, not the earlier listing, enforces emptiness at mutation.
- Missing methods produce typed `FsError("ENOTSUP", {syscall: "rmdir", path})`.
  Implementations may also reject unsupported paths. Neither case uses `rm`,
  recursive removal, capability casts, host subprocesses or extra dependencies.

## Measured GNU policy and deliberate divergence

`native-evidence.json` captures ten bounded host probes: three plain controls,
three syscall-logged controls, and four explicitly injected race/error probes.
Every probe records the full before/after namespace (directories, file bytes
and modes), generated diff, status, stdout and stderr. A nonempty sentinel
ancestor bounds each fixture set. Binaries are SHA-256 verified before and after
the run, not merely selected by name:

- GNU diffutils 3.12:
  `f13ef516c397b0281818ffe8685aa763100b56a6549295c91849c6af937a83c9`
- GNU patch 2.8:
  `c060444da0e547de6f17594baf0b5015a04f5b3277131ca12b1da27c621aee00`

All ten patch runs return **0**, print exactly
`patching file parent/leaf/file\n`, and have empty stderr. The generated diff
returns 1 with empty stderr. Native namespaces are not inferred from status:

| Profile | Final native namespace beyond root sentinel |
| --- | --- |
| Empty ancestors | Both ancestors removed |
| Nonempty parent | Leaf removed; parent and `keep` retained |
| Actual permission denial (parent mode 0555, uid 501) | Both empty ancestors retained |
| Injected ENOENT after another actor removes leaf | Leaf absent; parent removed |
| Child inserted at final unlinkat | Both ancestors and exact child bytes retained |
| Injected EACCES / EIO | Both empty ancestors retained |

The pinned source's `util.c:removedirs` ignores every failure and attempts
higher ancestors; `safe.c:safe_rmdir` uses `unlinkat(..., AT_REMOVEDIR)`.
Source hashes are recorded in the evidence. Instrumented runs load a test-only
macOS interposer into the **unchanged pinned binary**. Logged controls agree
exactly with uninstrumented controls; the ENOENT/child/error runs are labeled
injection, not naturally occurring native failures. The permission control is
an actual host permission failure. Exploratory interposer attempts were corrected
before this accepted capture; only the asserted final capture is this proof.

The consumer preserves typed ENOENT disappearance at inspection/listing/removal
and ENOTEMPTY at the final removal as expected outcomes. It makes no claim that
retained directories were removed. Typed ENOTEMPTY from a failed listing is not
mistaken for proof of a nonempty directory. All other failures remain nonzero,
including unsupported support, permissions, readonly, busy, type changes, EIO
and generic transport errors. Untyped errors include the pruning path.
**Reporting these failures deliberately diverges from GNU's broad suppression.**
It satisfies the explicit requirement not to swallow failed-pruning diagnostics.
This is not universal GNU compatibility or a stronger namespace transaction.

The GNU project's manual documents the file-removal behavior, not this complete
error policy; the pinned execution/source evidence is authoritative here:
<https://www.gnu.org/software/diffutils/manual/html_node/Creating-and-Removing.html>.

## Focused proof and unchanged denominators

Run only the new cohort and scoped no-emit typecheck:

```sh
node tests/commands/diff-patch/pruning-consumer/run.mjs
```

The runner requires exactly **61/61**, with no skips/cancellations/TODOs. It
records all consumed source/test hashes before and after, requires stable
inputs, and writes TAP/typecheck logs plus summary JSON to a unique `/tmp`
directory. It does not run native subprocesses inside product code.

Coverage includes both default and atomic publication; safe empty ancestor
removal; nonempty stops; backups and unrelated directories; dry runs; optional
method absence; unsupported implementations; typed permission/transport/readonly/
busy/type errors; untyped transport errors; pre-abort and blocked cancellation
with observed late rejection; errno-shaped abort reasons at the final ancestor
(never confused with tolerated stop conditions); ENOENT races at each phase; a child inserted
between listing and removal; final file/symlink replacement; and ancestor bounds.
An internal boundary check asserts the missing-method error is a typed FsError.
Every consumer case checks the complete resulting MemoryFS namespace, not only
status or target bytes. Actual `rm` calls are guarded against directory operands
and recursive mode. Fault injection wraps actual MemoryFS, without FS source edits.

`original70.json` independently hashes the frozen `4d4f5ca` test files. The
runner checks their contents and exact discovery before and after. The new test
suffix is `.acceptance.ts`, not `.test.ts`, so the original runner's denominator
stays **exact3758**. Its last supplied frozen result remains **3722 pass / 36
fail**, including 34 pruning failures and two expectation conflicts; this leaf
does not rerun or reclassify it. Original30 remains literal **14/16**, unchanged.
Revised96 belongs to the other author and remains a separate count. These 61
checks and ten native probes do not add to either acceptance denominator.

To recapture the native proof on the pinned macOS host (output remains separate
until reviewed, never silently overwriting the committed evidence):

```sh
node tests/commands/diff-patch/pruning-consumer/capture-native.mjs > /tmp/pruning-native-recapture.json
```

Only Node builtins and the host C compiler are used in the test-only capture.
It retains its bounded fixture and syscall logs for inspection. No TypeScript
emission/build step is used; the dedicated typecheck explicitly uses `--noEmit`.

## Current backend limitations

The focused suite validates the consumer against actual MemoryFS at `3a9177a`
with controlled boundary faults, not a cross-adapter acceptance matrix. Source
inspection of the separately owned backend checkpoints shows:

- Memory enforces type/emptiness at its synchronous namespace mutation.
- Real uses native empty-only `rmdir`; Mount forwards the optional operation and
  protects mount boundaries. This leaf does not independently certify those paths.
- Readonly rejects removal. Overlay supports only eligible upper directories
  isolated from a live lower layer; other empty paths can report `ENOTSUP`.
- S3 cannot atomically guard prefix emptiness and rejects empty removal with
  `ENOTSUP`. WebDAV likewise rejects it rather than issuing recursive collection
  DELETE. Their nonempty paths may report `ENOTEMPTY` before capability rejection.

Already published file effects can remain when pruning fails. Cancellation stops
the consumer's wait and propagates the supplied signal, but cannot roll back
host effects or interrupt an uncooperative operation. This change adds neither
descriptor-relative path identity nor a cross-provider namespace transaction.
Independent original3758, revised96, adapter and whole-product validation remain
separate root-coordinated work, with all failures and unsupported outcomes visible.

## Recorded focused results (2026-08-26)

- Final consumer cohort: **61/61**, zero skipped/cancelled/TODO, plus passing
  scoped `--noEmit`. Twenty consecutive strict-rejection repetitions each pass
  the same 61 unique checks with stable inputs and unchanged original70 hashes.
  Repetition evidence: `/tmp/safe-bash-diff-rmdir-consumer-repeat20.json`; the
  twentieth run is `/tmp/safe-bash-diff-rmdir-consumer-run-fFMWZD`.
- Product source `patch-gnu-paths.ts` SHA-256:
  `3a06d5b33d3c0df12ff83b0bbf4396d90906d6fd61e3ca1bd5537f508c4282af`.
- Consumed MemoryFS source SHA-256:
  `525b4e974b8ad0c0e08c00e78fa4b2239f789ef3922eb876fdf6e3ab79ef1d04`.
- Accepted native evidence SHA-256:
  `aefedc80e8cda88e8f5ccaab02bdadf4989cbb6ce51136ee955203be7f29898d`.
- The original3758 was not run; no whole-repository typecheck or package build
  is claimed by this focused checkpoint. See `verification.json` for the scoped
  result/source hashes; rerunning `run.mjs` records fresh evidence independently.
