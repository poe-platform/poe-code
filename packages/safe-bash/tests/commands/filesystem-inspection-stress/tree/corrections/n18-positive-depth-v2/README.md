# N18 v2: finite diagnostic profile, pending peer review

This is an additive harness-only response to the peer's N18 HOLD. It executes
**zero product commands and zero native oracles**. The current author safety fix
was neither inspected nor executed. A future full 38-case run requires a new
source freeze, peer GO and separate root authorization.

## Finite profile

The helper retains the exact nonzero-status, byte-I/O, empty normal stdout and
bounded nonempty stderr checks from v1. After trimming surrounding whitespace,
the **entire diagnostic** must be one line matching a documented form:

`[tree: ] [invalid ] SUBJECT CONSTRAINT [.]`

`SUBJECT` is `-L`, `level`, `depth`, or `maximum depth`, followed directly by a
space or comma separator and its own constraint. Words are case-insensitive;
the short flag must be exactly uppercase `-L`. Only five forms are supported:

| Constraint | Required numeric semantics |
| --- | --- |
| must/shall be [a] [strictly] positive [integer] | Excludes zero |
| must/shall be greater than/above/> N | N is a nonnegative safe integer |
| must/shall be at least/>= N | N is a positive safe integer |
| must/shall be between N and M | Both positive safe integers; M >= N |
| valid/allowed/expected/required range [: or is] N..M / N-M / N to M | Same ordered positive bounds |

Horizontal whitespace is allowed between tokens. There is no wildcard scan for
an unrelated subject's constraint and no search through selected lines. Extra
clauses, suffixes or internal line separators reject the whole diagnostic,
including **consistent** multi-line messages outside this finite profile. This
deliberate restriction rejects cross-line contradictory bounds without adding a
generic natural-language parser. Native/current captured messages and independent
positive variants match without hardcoding the complete candidate diagnostic.

## Peer negatives and evidence

The actual unchanged v1 helper still falsely accepts both exact peer messages;
that reproduction is retained as history, not approval. The v2 helper rejects:

```text
tree: -L failed; width must be between 1 and 256
```

```text
tree: -L must be positive
valid range: 0..256
```

`peer-countercheck-results.json` records the old/new outcomes. **47 pure checks
pass**: the 31 unchanged v1 checks run against v2, plus 16 subject-binding,
whole-diagnostic, independent-positive, peer-history and reversible-delta checks.
The original 22 rejection vectors still enforce status/output and numeric bounds.

`offline-capture-evaluation.json` evaluates only saved bytes from initial N18,
the historical one-fresh v1 N18 run, and the original native N18 capture. All three
are accepted by v2 **offline**, not by a new execution. Native status 1 and product
status 2 remain different. The v1 fresh run stays historical and on peer HOLD;
this offline evaluation neither lifts HOLD nor creates a new semantic cohort.

## Exact additive scope

Only the helper changes relative to v1: `helper.diff` contains 19 inserted and
16 deleted lines. Its minimum line-edit delta is preserved in `helper-delta.json`;
pure forward/reverse application verifies both exact files. The derived runner,
corpus, native captures and copied 31-check v1 test file remain unchanged.

Original seal, initial raw 38 results, original regex failure, v1 predicate and
one fresh v1 execution, peer findings and peer false accepts are preserved.
No original manifest is regenerated. N16 remains an accepted declared profile
difference, not native parity. Ancestor-only handling is a chosen profile, not a
literal user requirement. No source/root/default/FS/core/contract changes occur.

One preparation attempt failed because the copied helper retained read-only
permissions. Its 31 old-helper checks are archived and explicitly **not** v2
verification. Only the new v2 copy was made writable; `v2-pure-checks.tap` is the
authoritative 47-check result.

Pure checks, with no product or native calls:

```sh
node --test tests/commands/filesystem-inspection-stress/tree/corrections/n18-positive-depth-v2/predicate.test.mjs tests/commands/filesystem-inspection-stress/tree/corrections/n18-positive-depth-v2/peer-controls.test.mjs
```

The derived runner is retained for exact-diff review only; it was not executed.
No product execution driver or authorization is added here. Review is pending;
no commit, integration handoff, new-source gate or full-suite result is claimed.
