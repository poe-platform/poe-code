# Unchanged seven after the source/dot/eval checkpoint

## Readiness and immutable authority

On August27,2026, this independent tests-only leaf waited **56.057seconds** for
the explicit source-freeze handoff. `postfix-ready-wait.json` preserves the exact
notice and its hash; `postfix-ready-seal.json` records verification of commit
`489c8b7cd8f18988a5ddf53838795265adf270ad`, committed/current runtime equality,
and the author's relinquished write lease **before product import**. The notice's
author outcomes are context only, never expectations for these seven recipes.

The unchanged runner captured at **02:29:06.390–02:29:10.812 UTC**, after READY,
on stable HEAD `09926fb67452ca7db9bd793d87b78d2f41ff82be`. The new artifact's
preallocated name is `replay-postfix-20260827t0228.json`; its internal timestamps
give the actual capture time. Shell source is the READY commit above, following
source/dot `9172632` and eval `dd2505b`. Runtime SHA-256:
`e886b64536c7496769fdbe856aafb0e73ee88ace47c2a3ca9cb3cc71f11f8c4a`.

All11 files from `5cfb70a` remain byte-identical, including the complete corpus,
frozen expected observations, original replay artifacts, runner, import hook,
integrity tests, and original README. `postfix-validation.json` checks each
against the original Git commit. No recipe/expectation/helper changes, renames,
skips, xfails, substituted native oracle, or command-kind relabeling occurred.

## Measured results, separate from history

| Cohort | Historical5cfb70a | Fresh postfix |
| --- | --- | --- |
| Virtual vs unchanged frozen expectations | 0/7 | **3/7** |
| GNU5.3 vs unchanged frozen expectations | 7/7 | **7/7** |
| Historical Bash3.2 vs unchanged frozen expectations | 7/7 | **7/7** |
| Virtual vs GNU5.3 | 0/7 | **3/7** |
| Virtual vs Bash3.2 | 0/7 | **3/7** |

Both native profiles are **fresh complete seven-case executions**, not reused
snapshots. The original actual7×2 native evidence remains immutable. The runner
checks frozen executable identities, captures current binary hashes/versions and
exact argv/env, and repeats independent launcher/byte/PATH/version controls2/2.
GNU5.3 remains a consistent design profile, not a user-mandated dialect. No
additional3.2 difference occurs in these seven; other historical differences
are not erased. Four remaining virtual failures cause the expected replay exit1.

| Exact recipe | Current stdout | Current stderr | Status | Exact result |
| --- | --- | --- | --- | --- |
| kernel/type/type | `command\ncommand\nfunction\n` | empty | 0 | FAIL |
| kernel/executable-file/executable-file | empty | `shell: line 1: ./script: direct execution requires a supported Bash shebang\n` | 126 | FAIL |
| kernel/env-shebang/env-shebang | empty | `shell: line 1: ./script: unsupported interpreter: /usr/bin/env bash\n` | 126 | FAIL |
| kernel/source/source | `sourced` | empty | 0 | PASS |
| kernel/dot/dot | `dotted` | empty | 0 | PASS |
| kernel/eval/eval | `hello world` | empty | 0 | PASS |
| kernel/parameter/parameter | empty | `shell: Unterminated or unsupported parameter expansion at offset 70\n` | 2 | FAIL |

Expected stdout for the four failures is respectively
`builtin\nfile\nfunction\n`, `ran:argument`, `env:argument`, and
`abc:abc:XbcXbc`; each expects empty stderr and status0. **All seven file-tree
effects match expectations**, including unchanged script bytes. Full base64
stdout/stderr, status, and file trees for expected/current/original tuples are
retained in `postfix-validation.json`; raw fresh native observations and dispatch
events are retained in the replay artifact. Frozen native temporary-root rendering
is unchanged; no product output normalization is added.

Source/dot/eval are the **three newly passing exact recipes**, not proof of broad
source/dot/eval closure. The four other tuples are unchanged historical failures.
Type reports actual registered implementations: native builtin/file roles differ
from virtual command roles. That is an implementation-role fairness difference,
**not automatically a parser/dispatch bug**, and remains an exact comparison
failure. Headerless execution, env-shebang execution, and combined parameter
expansion remain real native-workflow gaps; none is waived or fixed by this leaf.

## Guards, validation, and limits

- Integrity tests3/3 and scoped test typecheck exit0; complete command output is
  in `postfix-validation.json`. No whole-product build/typecheck was performed.
- All156 source-file hashes are stable before/after capture. All130 actual source
  imports match their individual before/load/after hashes;132 total file imports
  are checked separately. READY runtime hash matches both endpoints.
- The later audit endpoint lists no additional source changes. Exact dirty
  statuses, HEADs, imported modules, and frozen-to-current dependency drift are
  retained. Archive format/README were dirty; non-shell core/jq/S3/archive changes
  from the older frozen product are not treated as unchanged dependencies.
  Stable measured inputs do **not** establish a clean aggregate product tree.
- All child process groups are absent, no live children remain, and temporary
  native/VFS-test scaffolding is removed. No SIGSTOP, new dependencies, product
  API, host-filesystem adapter, or network plugin was introduced.
- Invocation72/132 acceptance remains separate. Historical native51/57+49/57,
  old9 diagnostics, and5 custom-first-read lifecycle cases are **not rerun or
  closed**. Another leaf owns the43 source/dot/eval/native holdout verification;
  this replay does not duplicate or claim its work.
- No full224/baseline rerun, expanded scope, overall kernel parity, full Bash,
  superiority, or72-hour completion claim. Foreign files and staging remain
  untouched; this checkpoint adds only owned evidence/documentation.

To repeat the same seven later, from repository root:

```sh
node --import tsx --test tests/shell-stress/expanded-kernel/replay.test.ts
node tests/shell-stress/expanded-kernel/replay.mjs --record next-replay.json
```

Use a fresh evidence name; never overwrite the historical or postfix artifacts.
