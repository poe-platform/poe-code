# Independent canonical-profile review preparation

**Prepared 2026-08-27; no author candidate inspected or accepted.** Ownership is
this new directory only. No canonical test, fixture, oracle, source, manifest or
contract was edited. The closed errexit checkpoint at `6e3e316`/`694ec8a` is not
rerun; this is a different, bounded migration-mechanics review.

## Routing correction and exact inventory

The routing at `51282a9` contains **27 instances, not 29**:
**25 historical-profile instances + 2 classification losses**. Exact source
names, paths, original assertion lines/TAP records, hashes and committed Git
blob identities are in `inputs.json`; all 21 original inputs remain unchanged.

| Original file | Routed instances | Exact members |
| --- | ---: | --- |
| `tests/shell/invocation-discovery-fixes.test.ts` | 16 | `empty-path`, `terminator`, `unknown-z`, `unknown-x`, `unknown-combined`, `unknown-first`, `unknown-long`, `unknown-line`, each under historical Bash and sh |
| `tests/shell-stress/differential.test.ts` | 5 | `nested-substitution-syntax-error-does-not-prevent-earlier-effects`, `fatal-parameter-expansion-prevents-following-file-effect`, `fatal-arithmetic-expansion-prevents-following-file-effect`, `fatal-expansion-in-substitution-stops-substitution-only`, `command-substitution-removes-nul-bytes` |
| `tests/shell-stress/current-gaps/compatibility.test.ts` | 4 | `move-output-really-closes-source`, `move-input-really-closes-source`, `prevalidation-prior-output-and-file`, `fatal-parameter-preserves-only-earlier-effects` |
| `tests/shell-stress/invocation-closure/holdout.test.ts` | 2 | `query-V-verbose`, `type-multiple-status` |

The first group is 16 historical-discovery rows, not all discovery tests. The
second and third groups total nine, not nine in each file. All **27 routed
comparison losses** have current committed-source witnesses in
`review-summary.json`; this is not an assertion that the four original test
files were rerun wholesale through node:test. The nine routed differential/gap
rows reproduce their **original native and virtual tuples 9/9 each**, with the
original compared field set. They are **not** the separate archived OLD9 cohort.
Discovery and classification witnesses use the explicit named context described
below; no original file is relabeled or changed.

## Whole cohorts and contexts

The independent case inventory contains the complete affected data cohorts:
52 discovery invocations (26 cases × two roles), 72 differential, five syntax,
11 current-gaps and 26 closure rows = **166**, plus three independent controls
for diagnostic name/line identity, exact binary tuple/file-mode fidelity and
registry truth = **169**. The separate nine discovery host assertions, eight
closure host contracts and provenance test are not executed or claimed passed.

Both native binaries run the same complete 169-row roster. Existing closure
UTF-8 overrides stay explicit; all other rows use C. The reference file retains
literal source templates, rendered source, OS argv0, command `$0`, arguments,
stdin, env/cwd, tool versions/hashes and complete relative effects/modes.

The product executes **169 explicit named-interpreter contexts** and separately
**88 original direct-API contexts** for all differential/syntax/gap rows:
**257 product executions**, all guard-valid. These contexts are independent
review controls, **not an endorsed author migration**. Native startup-only
`--noprofile --norc` suppression is disclosed rather than passed to the virtual
API. No per-case binary selection, stderr normalization or status coercion occurs.

The existing helper's direct `Shell.exec` calls use diagnostic identity `shell`;
the original native helper passes `shell-stress`. The named control invokes real
`bash -c SOURCE shell-stress`, preserving literal source and explicit command
name. The extra `$0`/line control verifies actual named context, not a changed
display label. As detailed below, a real invocation boundary can change behavior.

## Fresh baseline counts, not full-gate extrapolation

The following match counts use **the original compared field shapes**: byte
stdout/stderr/status for discovery and closure; those plus file types/bytes for
differential/gaps. Syntax columns are deliberately **strict byte comparisons**,
whereas the original five syntax assertions require status2, no stdout/effects,
and nonempty stderr; all five original assertion shapes pass. Extra raw mode and
fixture-rendering differences remain recorded separately, never normalized away.

| Context / cohort | Denominator | GNU 5.3 match | Apple 3.2 match |
| --- | ---: | ---: | ---: |
| Original direct differential | 72 | 67 | 67 |
| Original direct syntax, strict bytes | 5 | 0 | 0 |
| Original direct gaps | 11 | 7 | 7 |
| Named discovery | 52 | 52 | 36 |
| Named differential | 72 | 71 | 67 |
| Named syntax, strict bytes | 5 | 5 | 0 |
| Named gaps | 11 | 10 | 7 |
| Named closure | 26 | 24 | 12 |
| Named independent controls | 3 | 2 | 1 |

For the routed nine diagnostic cases, the original direct context is strict
**0/9** against either native profile. The named control becomes **7/9** against
GNU, not 9/9: two statuses change. This contradicts any assumption that changing
the binary and wrapping the source is automatically an assertion-preserving fix.

Full raw tuples including **all file modes and initial fixture bytes** match
GNU in only **68/169** named rows, and Apple in **45/169**. This stricter auxiliary
metric includes existing 0666-versus-0644 creation modes, 0777-versus-0755 fixture
directories and native-profile versus virtual shebang fixture rendering. The old
suites did not assert all those fields. Their smaller assertion surface is not
silently enlarged, nor are the extra losses hidden or called native parity.
No creation-mask or filesystem change is proposed by this leaf.

## Concrete discrepancy: a named wrapper changes two statuses

These are **unchanged original workloads**, not new syntax:

```sh
: "${missing:?stop}"; : >after
```

```sh
printf before >before; : "${missing:?stop}"; printf after >after
```

Pinned GNU5.3 `-c SOURCE shell-stress` returns **127** for both. The original
direct virtual API also returns **127**, with `shell: line 1: missing: stop\n`.
The explicit virtual `bash -c SOURCE shell-stress` control instead returns **1**,
while its stderr now exactly matches GNU's
`shell-stress: line 1: missing: stop\n`. All stdout is empty. The first case has
no files; the second retains `before` containing `before` and no `after` in both
engines, but keeps the additional native0644/virtual0666 mode difference.

The committed implementation explains the observation: `runtime.ts:503` emits
127 for a `ParameterExpansionFailure` only when state is not isolated;
`runtime.ts:998` sets a fresh interpreter's `isolated:true`, and
`runtime.ts:1026` uses that state. This source reading is from pinned `6e3e316`,
not the moving tree. It is a **pre-existing entry-context distinction** exposed
by the proposed kind of test-helper wrapper, not a source edit by this leaf or
a regression attributed to an unseen author proposal.

Do not change expected127 to1, weaken status checks, or claim the wrapper fixes
all nine. The eventual candidate needs an explicit, uniform invocation/profile
strategy preserving its supported assertions, with actual source/name/line/$0
proof. No alternative strategy was secretly tried for a green result. Source
changes are unauthorized; ROOT must decide any follow-up beyond test review.

## Registry truth: separate supported-plugin assertions

Both native profiles report `printf` as a builtin. The actual virtual registry
contains `printf`; its observed `type -t` result is `command`, and verbose output
says `printf is a registered command`. The two routed rows remain **native raw
losses**, not fabricated native passes. Independently authored safe-plugin
expectations for those two complete output tuples and the extra registry control
all pass **3/3**, with registry membership proof. They were written before
product results were inspected, not produced by replacing native output text.

The standard registry also contains `true`, while internal builtin precedence
truthfully reports it as builtin. Registry membership alone is not blindly
converted into a classification label. `review-checks.mjs` checks both observed
output and actual membership and rejects a spoofed native-builtin label.

## Native preparation correction retained

`native-frozen.json` preserves the **first 338 native observations**. Its nested
sh aliases were named `gnu53-sh`/`apple32-sh`, which do not establish the intended
sh basename role. Before any product capture, the infrastructure was corrected
to paths ending in `/sh`; explicit native controls prove POSIX mode is on.
`native-role-corrected.json` contains the **second complete 338-row capture** and
is the comparison reference. No source/case/expected bytes were changed to fit
product output. This is **676 actual native case executions**, not a claim that
only338 ran. Both captures and the correction mechanism remain immutable after
the preparation commit; no partial per-case oracle selection was used.

Authoritative native capture completed **2026-08-27T06:30:05.162Z**, before
product baseline **06:34:17.194Z–06:35:52.596Z**. Actual binaries:

```text
GNU bash 5.3.0(1)-release (aarch64-apple-darwin25.4.0)
/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash
8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c
GNU bash 3.2.57(1)-release (arm64-apple-darwin25)
/bin/bash
35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3
```

Cat/head/locale tool hashes, locale availability and endpoint equality are also
recorded. This is a Darwin profile, not GNU/Linux env ordering. Native groups
have bounded deadlines/output and are removed with their owned fixtures.

## Source isolation, immutability and checks

Full committed source at **`6e3e3165e3b88aa5518eac33afd0b2ecdfa5fd2a`** was
archived: 173 source files plus four unchanged package/TS manifests. No live src
overlay or narrow API substitution. The broad public root and real standard
registry composition were used. Each of **257** executions has **166** actual
module load records, including **142** product files matching Git blobs inside
the archive; live source aliases are rejected before/after load. All per-phase
184-file archive and 314-file development-toolchain guards are stable. The
existing node_modules symlink is disclosed; no installation/dependency was added.
Node is v22.22.2 on Darwin arm64; its binary hash is retained.

```text
runtime: 5589f60a1db983538d37168e3b9276555ef71a2bc67446783535e47789f9d6eb
parser: 10d015eb62fd4e4f964666c04e5869ea78afdb76d930181760adecbcf16ab65e
native-role-corrected.json:
f0cf9e77a7d1feb909529ae023dc859a7ba5fa7e19895ef09dd24b98b748083e
baseline-6e3e316.json:
5addc1467accf1ff7e9d2156b1e26efcd6506f663e9d042093116abe1b07449f
```

Live HEAD moved during capture from `d1a425d15bf98217c0d2bf74b2f8a0d35620982a`
to `c7aa2edff4b1e86593bee95c4c713a6b569cde80`; those newer source changes were
not imported and are not verified here. The raw archive audit was saved before
temporary cleanup; the receipt binds its hash and confirms absent process groups.

Independent negative controls reject **12/12** mutated records/identities and
retain two positive controls. They cover status-only/stderr-discard errors,
stdout/file/mode corruption, source/name/profile switching, mass-golden rewriting
and classification spoofing. They currently verify this independent checker,
**not an unseen candidate's assertions**. Later review must inject the same
negative controls into the actual candidate assertion paths.

`REVIEW_PLAN.md` is the pre-candidate review plan. Record-only integrity checks
and syntax checks do not rerun product/native cases:

```sh
node --test tests/shell-stress/canonical-profile-review/integrity.test.mjs
```

No accepted accounting, public consumer, hidden-errexit, original kernel,
OLD9 diagnostics or five custom-first-read1200ms cases were rerun or closed.
Historical30/36 and52/57 remain historical. No source/core/FS/contracts/manifests,
creation-mask/lifecycle APIs or canonical test files changed. No author proposal
was inspected. This preparation is not migration acceptance, full Bash, full-gate
green, native parity or superiority evidence. Stop after the immutable commit
and await ROOT's candidate relay; do not poll or inspect the author early.
