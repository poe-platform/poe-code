# ROOT ratification — read-only Git M1 profile

Date: 2026-08-28. Authority: latest ROOT direction supplied to this documentation leaf.
Status: authoritative PROJECT PROFILE, not native observations or implementation GO.

## Bound historical inputs

- Independent review: `12e943bd3664a2f8286fc3063542877ae7f56a8e`, all five documents in `tests/commands/git-independent-20260828/`.
- Author packet: `589d1d93e2cd87296949ff32d8bf4d9bbef6cbcc`, in `tests/commands/git-design-20260828/`.
- Author `BINDING.json` SHA-256: `b046c0dd2765eb86d7fc9ec1b77092d61a2f987568138465bb77bbf0790f1aff`.

## Ratified profile

- All 24 numeric defaults are fixed M1 maxima, exactly as listed in the bound
  independent `REVIEW.md`, D1 “limits are defaults, not an accepted override
  contract,” numeric table at lines 45–57. No public limit overrides initially.
  Retain validated `replace` and `discoveryBoundary`.
- M1A refuses ANY pack/idx/promisor storage before ANY successful output, even
  when loose copies exist. Packed-refs remain supported.
- M1A supports standard `.git` DIRECTORY worktrees and genuine bare repositories.
  Gitfile, `commondir`, and linked-worktree routing are explicitly unsupported
  and refused in M1A; later support is possible, never false-clean behavior.
- Refuse alternates, shallow repositories, replace refs, grafts, promisor storage,
  and unsupported repository formats/extensions.
- Config admission MUST specify an exact finite allow/ignore/refuse table.
  Harmless inert user/remote/branch metadata MAY be ignored; no includes,
  execution, or global ambient config. Conversion-, case-, mode-, symlink-, and
  routing-affecting settings cannot be silently ignored.
- Conservative refusal of unsupported actual content conversion/attributes is
  allowed; the author MUST specify the exact detection domain. This establishes
  neither config-default nor native-parity claims.
- Preserve raw bytes, literal paths, truthful modes, and no renames. Retain
  unmerged status/stages, but REFUSE selected-unmerged diff.
- Raw blob show and byte-correct names/quiet comparisons work for arbitrary blobs;
  binary patch generation is explicitly refused.
- Freeze the UTF-8/text-patch domain and deterministic bounded algorithm, with
  patch-applicability proof, NOT native hunk parity. Close full REV suffix/type/path
  semantics and complete bounded abbreviation census. No native fallback or dependencies.

## Reconciliation and next authority

This selects the deferral/refusal alternative to earlier R3: gitfile, `commondir`,
and linked worktrees are deferred/refused, not admitted M1A routing. The author's
separate successor matrix must reflect that decision, including affected A09;
historical matrix scenarios are not retroactively passes.

Original R1–R6 PENDING/proposals and both historical packets remain unchanged.
The historical six workflows, 11 objects, two commits, and 184-byte index are not
new acceptance evidence. All 72 future cases remain unexecuted; any updated future
matrix is separate. This record adds no native, product, test, build, or gate evidence.

Exact author closure is required before implementation. ROOT will relay it to the
author; this message grants NO implementation GO. A limited OPT-IN M1A module may
be accepted before M1B, but no default packed-readiness exists until actual M1B
and different-agent review. Stop after this record; no speculative features.
