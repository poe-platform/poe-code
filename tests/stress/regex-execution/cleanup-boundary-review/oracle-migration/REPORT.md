# Approved fixture migration: compiled benign cohort

The corrected public-runtime cohort passes **9/9 groups** in one bounded run on
August 27, 2026 at 09:08:21 UTC. This is new, expressly approved fixture evidence,
not a rewrite of the original **7/8** result. No production or contract change,
pathological probe, independent six-slot execution, or performance rerun occurred.

## Exact fixture delta and preserved history

The approved adjudication is `c6303827ea27a53a42806879103fcddac5972201`.
Before editing, `original-runtime.mjs.txt` preserves all original bytes from
`10273352f8d65d929cbf5a23e69119414dacee60`, SHA-256
`34c3d137b96c4e963573977c92d478f3bd0d670fd2b7bf32bace1fdf852dd007`.
`original-freeze.json` also freezes 69 surrounding historical artifacts.
They remain unchanged, including the original failing cohort, original-five
fixtures/evidence, and all sixteen independent positive adjudication variants.
Those sixteen remain four distinct historical groups with the separately
disclosed group-2 harness correction, not a new single-run 4/4 claim.

Only the wrong-layer primary becomes `new api.ShellLimitError('maxCommands')`.
The existing enumerable `limit` and `name` properties are checked explicitly;
the original empty-key assertion remains in the new ordinary-Error control.
All original caller reasons (`0`, `false`, empty string, errno-shaped object),
the no-abort case, both failing cleanup hooks, held drain, and strict selected
rejection identity remain. Seven other original group bodies are byte-unchanged.
The audit reverses only this correction and the added group and reconstructs
the original fixture exactly.

The separate ordinary-throw group has three variants: no cleanup resolves
exit 1 with empty stdout and exact stderr
`shell: line 1: selected execution failure\n`; one failing cleanup rejects with
that exact cleanup object; two failures reject with an AggregateError containing
both exact objects. The latter two still wait for held cleanup and retain the
exact diagnostic and empty stdout. No generic rejection normalization or
weakened product error-precedence rule is introduced.

Fixture-only commits:
- `5a93969794e749db31b636dc90ecf9a352c42242`: approved correction and separate ordinary group.
- `8d0909ff3cf29290051e3d91dc3205e629ef6bda`: one additional strict object-membership assertion.

The final fixture SHA-256 is
`f0bfe258a8851d5709c10b5fc581a9c32d0daa2cbdd1f5dc828716102ff7cf22`.
There are two narrowly scoped fixture commits rather than the requested single
combined commit. An attempted amendment raced with the verifier's concurrent
commit. The resulting mistaken `4278992be8d5a8598d46d58be9123fc78464b5cc`
was undone using a reviewed compare-and-swap ref restoration to the verifier's
original `a3d3f773bac699bd11ac37f53694004cc4842797`; all file contents were
retained. The one-line follow-up was then committed only to `runtime.mjs`.
The original verifier commit is intact in ancestry. No foreign file was edited,
staged, or retained in either final fixture-only commit.

## Frozen product and prepared guard

- Runtime: `1b133a8662a32ee84524794842074c9c98d5f6c3`.
- Registration: `01aa1bffe0568cc6787d5ff8e0331e024a787385`; all four files match runtime.
- Messageerror fixture: `10273352f8d65d929cbf5a23e69119414dacee60`; exact file matches runtime.
- Prior evidence: `c3a364761091a79af9bbd74af7fa5d09356966c3`.
- Source-freeze SHA-256: `ef7d7c018ca19cc699a3ddcd009b8d1197de416f154651885738ce7537369b2e`.
- Build-manifest SHA-256: `9194095150789c25ff250aa746b567aac584d433a6330180f37d4924195a30d9`.

The existing `.temporary/runtime-r1-verified` snapshot is reused. Both manifests
match immutable c3a3647 bytes. All 216 source/config identities match immutable
runtime Git bytes and the snapshot; all 704 emitted files match the successful
frozen build. The two command contract files also match the approved contract
commit. No live product source/dist, rebuild, global typecheck, native DATA
folder, external oracle, new dependency, or new production snapshot is involved.

`run.mjs` reuses the prepared `guard.mjs` child lifecycle with new output paths,
immutable preflight, the unchanged c3a3647 public-boundary observer, and explicit
post-close assertions. Output files are exclusive-create; historical JSON is
never overwritten. The product uses the corrected committed fixture, not a
parallel rewritten body. Limits remain 128 MiB child heap, 20-second exact-child
watchdog, 64 KiB console, 1 MiB IPC, and 1.2-second fixture observation bounds.
Strict unhandled-rejection mode is enabled for the guard and child; the original
observer/product worker options are unchanged.

## Counts and cleanup

| Corrected group | Result |
| --- | --- |
| All sync/async/duplicate cleanup drains | 3 variants pass |
| Genuine primary rejection and caller identities | 5 variants pass |
| Ordinary throw result and cleanup identities | 3 variants pass |
| Nested abort and late admission | pass |
| Pipeline, substitution, nested invocation drains | 3 variants pass |
| Overlapping/repeated dispose | pass |
| Same/other-shell cancellation isolation | pass |
| Opaque stdin/FS/sink/middleware | 4 variants pass |
| Admitted cooperative acquisition | pass |

The single child PID 85178 exits 0 without signal, timeout, or kill. IPC
disconnects; stdout and stderr close empty; exact-PID checks find it absent.
All nine groups perform the prepared finally/disposal/task settlement checks.
The unchanged observer records 51 public boundaries (25 exec, 26 dispose) and
two benign regex workers. Both workers exit, their termination is awaited, and
all final worker listeners are zero. Each recorded exec has zero command abort
listeners and unchanged caller listener count; its own workers are already
retired in the public promise continuation. These are scoped observations, not
claims about arbitrary opaque host work or comprehensive release readiness.

## Commands and handoff

Run from repository root; choose a fresh label for any authorized replay:

```sh
node --check tests/stress/regex-execution/cleanup-boundary-review/runtime.mjs
node --check tests/stress/regex-execution/cleanup-boundary-review/oracle-migration/run.mjs
node --check tests/stress/regex-execution/cleanup-boundary-review/oracle-migration/verify.mjs
node --unhandled-rejections=strict tests/stress/regex-execution/cleanup-boundary-review/oracle-migration/run.mjs corrected-compiled-r1
node --unhandled-rejections=strict tests/stress/regex-execution/cleanup-boundary-review/oracle-migration/audit.mjs corrected-compiled-r1
git diff --check -- tests/stress/regex-execution/cleanup-boundary-review/runtime.mjs tests/stress/regex-execution/cleanup-boundary-review/oracle-migration
```

The ready marker `/tmp/regex-runtime-oracle-migration-ready.txt` was published
immediately after green/cleanup, with evidence commit pending, for the different
verifier's packed corrected cohort. This author does not execute that cohort.
Historical original-five compiled **5/5** and packed **5/5** remain accepted
scoped evidence, not rerun. The five custom first-read controls remain separate.
Historical original 12 and newly allocated 6 risk budgets remain distinct:
author consumption is **0**, all **6 remain UNUSED** at this handoff. Only the
different verifier owns those six and its final-review directory; root must
relay separate risk approval after both benign cohorts pass.

User baseline **17.784 vs 15.617** is retained, not remeasured or reinterpreted.
No default acceptance, superiority, 72-hour duration, or full-completion claim
follows. New result, verification, and audit JSON retain exact hashes, counts,
commands/profile and child cleanup; protected historical artifacts stay intact.
