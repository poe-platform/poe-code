---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
---

# Issue 647: generated diagnostics and default filename display

## 1. What we're building

Implement kamilio's issue 647 body and comment, verified with gh on September 6,
2026: escape diagnostic C0/C1 controls except LF/TAB, and use existing tree
escaping for default ls/find filename display. Root explicitly accepted this
display compatibility change. Diagnostics alone do not complete this issue.

No global stderr filtering, structured FsError mutation, guest output filtering,
or changes to find -print0/exec raw paths. No terminal-exploit or universal
terminal-safety claim. LF/TAB remain permitted in diagnostics by author policy.

## 2. User-facing shape

Tree's existing backslash/octal filename representation also applies to ls names,
directory headers, symlink targets, and implicit/explicit find -print. It does not
apply to find -print0 or lookup/argv data. Generated diagnostics escape controls
without doubling existing backslash text or escaping ordinary Unicode.

Verbose cp/mkdir/mv/rm/rmdir messages escape their filename fields with the same
display policy; filesystem operations still receive the original paths. This is
an intentional display compatibility change, including when stdout is piped.
Use find -print0 and raw argv substitution for filename transport, not parsing
the escaped listings as original paths. No TTY detection is inferred from ByteSink.

## 3. Implementation details and technical decisions

Extract tree's escape policy to an internal reusable module. Route only generated
diagnostic writers through control escaping; preserve existing family budgets,
status selection, write awaiting, and cleanup. Audit shell runtime/syntax and
family writers independently of the common command diagnostic helper.

The internal helper has separate display and diagnostic modes. Display retains
tree's byte policy: printable ASCII except backslash is unchanged, familiar
control escapes are used where tree already used them, and other UTF-8 bytes use
three-digit octal. Diagnostic mode preserves LF/TAB, ordinary Unicode and literal
backslashes, but escapes other C0, DEL and C1 codepoints. U+009B becomes the ASCII
sequence `\\302\\233`, not a raw control. This does not add Cf/bidi filtering or
promise that permitted LF/TAB cannot affect presentation.

Generated diagnostic streaming uses independently encoded chunks of at most
16,384 bytes and cooperative checkpoints every 1,024 rendered fragments. It
awaits writes and preserves falsey failure/cancellation identities. This is not
a CPU-time guarantee, a universal output cap, or a replacement for an invocation's
output ownership/cleanup contract. In particular writeBytes does not itself opt
into ownedOutput; existing OutputOperation/Node ownership remains authoritative.

Existing family caps apply to rendered bytes before output: jq's queued message
and location allowance, yq's displayed-source cap, Node's remaining output budget,
and apply_patch/column/HTML/archive truncation. Preserve their existing fallback
and status policies. Which's existing diagnostic path admission remains separate
from its stdout maxOutputBytes accounting. Xan sizes the rendered diagnostic in
a bounded-work first pass and then writes into admitted storage using at most
eight encoded scratch bytes per character; it retains no full escapedParts copy.

Expr's unexpected-operand quoting already escaped controls, but validated regex
worker error replies could carry raw controls. Its final diagnostic now escapes
before output-byte admission without changing the structured worker reply.

Excluded ownership: streams.ts, tail-follow.ts, browser.ts, commands/index.ts,
plugins/index.ts, safe-fs, README and root registration. The new tail writer
currently delegates its diagnostics to commands/internal.ts and needs no direct
edit for that path. No Git mutations, builds or full guards by this worker.
Issue 624 owns network/curl.ts, network/types.ts and its new aggregate-budget
files; this patch changes only network/shared.ts in that family. Input.ts and
the committed issue 639 runtime constructor/checkpoint fix remain untouched.

## 4. Interfaces and test plan

Root registers these literal new paths:
- packages/safe-bash/tests/contracts/diagnostic-escaping.test.ts
- packages/safe-bash/tests/commands/diagnostic-display.test.ts

TDD: preserve initial failures before production changes, then verify generated
controls, default listing semantics, tree compatibility, structured FsError
identity, raw stderr, print0/exec interoperability, backpressure and falsey
cancellation. Run focused/adjacent tests only, TSX_DISABLE_CACHE=1, with the
supplied Node toolchain and validation base as working directory.

## 5. Code plan

Root owns independent integration, registration, freeze/shelf operations, final
gates and delivery. The following are the exact 34 issue-owned checkout paths;
the last four are new files. No other worker's paths belong to this patch.

```text
packages/safe-bash/src/commands/internal.ts
packages/safe-bash/src/commands/tree/io.ts
packages/safe-bash/src/commands/find.ts
packages/safe-bash/src/commands/filesystem.ts
packages/safe-bash/src/shell/shell.ts
packages/safe-bash/src/shell/runtime.ts
packages/safe-bash/src/commands/basic.ts
packages/safe-bash/src/commands/text-programs/shared.ts
packages/safe-bash/src/commands/time-env/shared.ts
packages/safe-bash/src/commands/search/shared.ts
packages/safe-bash/src/commands/diff-patch/shared.ts
packages/safe-bash/src/commands/split/split.ts
packages/safe-bash/src/commands/column/internal.ts
packages/safe-bash/src/commands/structured/jq.ts
packages/safe-bash/src/commands/html-to-markdown/index.ts
packages/safe-bash/src/commands/which/which.ts
packages/safe-bash/src/commands/execution.ts
packages/safe-bash/src/commands/network/shared.ts
packages/safe-bash/src/commands/apply-patch/shared.ts
packages/safe-bash/src/commands/du/budget.ts
packages/safe-bash/src/commands/archive/index.ts
packages/safe-bash/src/commands/archive/create.ts
packages/safe-bash/src/commands/yq/index.ts
packages/safe-bash/src/commands/safejs/index.ts
packages/safe-bash/src/commands/node/host.ts
packages/safe-bash/src/commands/xan/index.ts
packages/safe-bash/src/commands/expr/index.ts
packages/safe-bash/tests/commands/directory-admission.test.ts
packages/safe-bash/tests/shell/env-shebang.cases.ts
packages/safe-bash/tests/shell/expanded-gaps-env-host.cases.ts
packages/safe-bash/src/escaping.ts
packages/safe-bash/tests/contracts/diagnostic-escaping.test.ts
packages/safe-bash/tests/commands/diagnostic-display.test.ts
docs/plans/bugfix-647-diagnostic-escaping.md
```

## Evidence

### Historical RED/GREEN before the issue 639 shelf

- Initial 44-test run: 8 passes, 36 failures before the shared/helper/display fix.
  The subsequent first-wave 46/46 GREEN is historical, not current qualification.
- Family-specific RED cases preceded changes; the second wave reached 10/10 GREEN.
  Corrected invalid witnesses rather than changing production for them: apply_patch
  rejects C0 paths without echoing them, so its witness uses C1; curl unknown-option
  messages are fixed text, so its witness uses an injected transport failure; the
  Node mock must grant stderr and satisfy the provider retirement contract.
- Root shelved/restored 29 files around issue 639 delivery. Runtime's diagnostic-only
  patch was separately saved as `/tmp/kamilio-647-runtime-diagnostics.patch`, 29,709
  bytes, SHA-256 `60b2178f8bc9035eee8f09b34d452d3948d68b840bd6cdbc7cf4add27e136c0b`.
  On resumption its fingerprint was verified and only its hunks were restored with
  apply_patch, preserving the committed runtime constructor checkpoint changes.

### Current focused qualification, September 6, 2026

- Fresh normal-isolation RED: all six new cases failed on raw bytes (mocked expr
  worker error plus five verbose filesystem messages), before those production fixes.
- Xan's first boundary test omitted the existing `count` prefix. After correcting
  that expectation, restored only this worker's pre-refactor renderer and observed
  the valid retained-storage RED again, then applied the two-pass fix. Do not count
  the earlier malformed expectation as accounting evidence.
- Two other test expectations were corrected without production changes: the
  heredoc warning already uses JSON quoting, which must remain unchanged; jq does
  not implement error/1, so the queued-error case uses supported tonumber and a
  newline-terminated input with an untrusted string and filename.
- Final two new files: **86 tests passed, zero failed/cancelled/skipped**, 760.498 ms.
  Coverage includes rendered-byte boundaries, falsey abort and sink failures,
  blocked/owned sinks, stable accepted prefixes and byte ownership, original
  FsError fields, raw guest stderr, print0/pipelines/exec, sorting and display sites.
- First adjacent batch: **511/512 passed**, 3,736.977 ms. The sole failure was the
  diagnostic-context-bounds wrapper's child `--import tsx`: package resolution from
  the validation-base cwd failed before its checks. Re-running this unchanged
  wrapper with an explicit package-directory cd passed **1/1**, 383.840 ms. The exec
  tool workdir remained the validation base. This is a separate rerun, not a clean
  initial 512-test result.
- Second adjacent batch: **1,733/1,733 passed**, zero failed/cancelled/skipped,
  5,571.931 ms. Across the adjacent runs all 2,245 selected tests ultimately passed.

All current runs use Node 22.22.0 from
`/var/tmp/poe-code-kamilio-toolchain.GzqQj3/bin/node`, `TSX_DISABLE_CACHE=1`, the
absolute repo tsx loader, `--test --test-concurrency=1 --test-reporter=tap`, and
normal process isolation (no `--experimental-test-isolation=none`). Sandbox
child-process failures produced no useful test result; approved normal-isolation
runs supplied the evidence above. Output summaries/diagnostic inspection use
escaped JSON rather than raw terminal control payloads.

Adjacent batch 1 paths, under packages/safe-bash/tests:

```text
commands/basic.test.ts
commands/execution.test.ts
commands/filesystem.test.ts
commands/find-time-delete.test.ts
commands/ls-human-sort.test.ts
commands/tree/behavior.test.ts
commands/tree/work-budget.test.ts
commands/which/limits.test.ts
commands/column/limits.test.ts
commands/html-to-markdown/limits.test.ts
shell/diagnostic-context.test.ts
shell/diagnostic-context-bounds.test.ts
shell/diagnostic-regressions.test.ts
shell/fs-error-diagnostics.test.ts
shell/fatal-diagnostics.test.ts
shell/source-dot-eval-diagnostics.test.ts
```

Adjacent batch 2 paths, under packages/safe-bash/tests:

```text
commands/structured/cli.test.ts
commands/structured/byte-ownership.test.ts
commands/column/lifecycle.test.ts
commands/which/safety.test.ts
commands/split/contracts.test.ts
commands/time-env/format-regressions.test.ts
commands/text-programs/text-programs.test.ts
commands/diff-patch/diff-patch.test.ts
commands/archive/core.test.ts
commands/safejs/command.test.ts
commands/safejs/lifecycle.test.ts
commands/expr/expression.test.ts
commands/table-text/contracts.test.ts
```

### Remaining integration limits

No build, typecheck, lint, full unit gate, commit, push or release qualification by
this worker. Lint remains pending root's maintained guarded route; no ad hoc lint
or guard bypass was used. Concurrent issue 624 source changes are not frozen or
qualified by these tests. Root must register the two new literal test paths and
run integrated maintained gates. No terminal exploit, raw-pipeline equivalence of
escaped ls/find text, or universal early-close/cleanup guarantee is claimed.

### Root gate compatibility follow-up, September 6, 2026

Root subsequently reported passing build, types, the 86 focused tests, full lint
and package checks. Preserve the initial full npm test result separately: shared
33,716 passed / 42 skipped; Python 29 passed; Bash runner 279 passed; Bash tests
21,257 passed / 3 failed / 63 skipped. That full run was not green. Its RED evidence
is `/home/kjopek/kamilio-validation-569-575.RoFXyZ/issue-647-gate.XY7q9Q/unit.log`.

The three failures were intentional byte-policy expectation mismatches. The
follow-up changes only these existing tests and this plan, not product code:

- `tests/commands/directory-admission.test.ts`: expected ls/find display for the
  actual filename `é` is now literal `\\303\\251`. The unordered backend, original
  filename fixture, and expected lexical sequence Z/a/é are unchanged; this does
  not sort the escaped representation or normalize observed output.
- `tests/shell/env-shebang.cases.ts`: the diagnostic regex now matches literal
  `\\r`. The shebang's actual carriage return, status 127, empty stdout and bridge
  checks remain unchanged.
- `tests/shell/expanded-gaps-env-host.cases.ts`: the expected diagnostic string
  now contains literal `\\r`. The raw CR-bearing shebang input, status/stdout tuple,
  filesystem contents and byte-for-byte script preservation assertions remain.

Both case files run through the maintained `tests/shell/shell-language.test.ts`
wrapper. That wrapper plus `tests/commands/directory-admission.test.ts` passed
**223/223**, zero failures/cancellations/skips, 1,579.504 ms, using the same Node
toolchain, absolute tsx loader, TSX_DISABLE_CACHE=1 and normal process isolation.
The exec workdir was the validation base. No Git, build or lint commands were run
for this follow-up. This focused GREEN does not replace a subsequent full npm test.

Root also reported a memory-only visual probe against built public
`poe-code/safe-bash`, captured with `scripts/screenshot.ts`. Root viewed the external
gate capture `diagnostic-display-corrected.png`: ls, ls -l, find, a missing
ESC-bearing filename and a C1-bearing unknown command display literal escapes;
the final marker remains intact. The first capture's product output already
passed, but the probe's own JSON label retained C1. The corrected probe escapes
that label; no product change followed. Both captures remain external gate
artifacts, not checkout additions. This is root-reported visual evidence, not an
independent terminal-security guarantee or a completed delivery claim.
