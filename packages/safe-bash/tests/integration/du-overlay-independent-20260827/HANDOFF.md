# Qualified baseline/freeze handoff

Date: 2026-08-27

## Status and hard boundary

This is a qualified **BASELINE/FREEZE HANDOFF**. It is not candidate acceptance,
not a whole gate, and not native parity. The new candidate hash is **UNSUPPLIED**:
**WAITING FOR AUTHOR CANDIDATE**. The refined-v2 exact cases are frozen but
unexecuted. Source evidence verifies known baseline bugs; it does not verify a
fixed candidate. No new product bug beyond the known baseline issues was
identified by the completed independent read-only audit.

## Freeze chronology and authenticated inputs

- Initial freeze `510c621e1dfa8f7ffba1d796f5f7e55d967368e2`:
  contract timestamp `2026-08-27T18:11:22Z`; commit timestamp
  `2026-08-27T18:12:07Z`. This point is pre-verifier-source-inspection only; it
  is **not** pre-author-source-commit.
- Refinement `8c28d7c848311372cbef5ec3e4facff546baf0a8`:
  freeze timestamp `2026-08-27T18:17:26Z`; commit timestamp
  `2026-08-27T18:18:51Z`. It followed authorized baseline API inspection and
  included no candidate inspection.
- Evidence commit: `82e97559330cff52f63f22c7d5fd80185fe65f44`.
- Baseline commit: `877144ea3a5223bbdf3e7ebfd50a8f8caaa474f3`.
- The verifier checked the exact hashes of four named source files and the
  249-file selected-input archive.

The 24 actual cases comprise 12 expected reds (10 upper-`rm` mutations and two
selected `DU_BLOCK_SIZE` invalid/empty environment failures), five purity
passes, and seven controls. The scoped regression result was 128/128. Strict
invalid `-B` and valid explicit `-B` passed. The mutants exercise genuine proxy
behavior—remove, content-read, and copy-up behavior—not inverted expected
values. The conceptual coverage includes direct and read-only access, both mount
directions, pending and active states, failure/retry, and pre-abort/mid-cancel.
The original strict upper-`rm` artifact remains unchanged; three native ordering
differences remain retained; the repeated-operand policy remains unapproved.

## Frozen-v2 versus executed harness

The existing final harness implements the original conceptual matrix, but it
does not execute the literal refined-v2 fixtures. The differences include:

- a different pending/whiteout fixture;
- a one-sided overlay-over-mount construction;
- upper-`readdir` failure/abort injection;
- a `mkdir` active stage; and
- a 2049-byte apparent-size environment fixture.

These exact v2 fixtures must not be described as executed. The relevant code and
fixture definitions remain anchored at `verify.mjs:156`, `verify.mjs:246`,
`verify.mjs:448`, and `HOLDOUT_REFINEMENT_V2.md:33`.

## Relocated-package proof and remaining replay

The moved-package proof is valid but narrower than candidate acceptance. The
actual tarball was installed into a distinct relocated consumer, checked under
strict NodeNext types, with root/DU containment and hash checks. Its standalone
module-path runtime proof covers only the `du -bs /moved` happy path. See
`consumer/consumer.mjs:9`.

It does not replay overlay, failure, cancellation, or environment holdouts
against the installed package. Those replays remain pending candidate
verification and must use the installed module path. Public DU is intentionally
absent, so there is no public-wiring assertion. This handoff does not expand the
implementation audit.

## Scope, preservation, and operational audit

The evidence commit contains 122 files, all within the owned integration
subtree, with no `AGENTS.md`, source, root-package, or export changes. Final
capture index fingerprints match. Earlier preservation of foreign staging is
supported by retained logs; see `REPORT.md:41`. Raw failed captures and the
WebDAV/allocation-fixture corrections are retained. Evidence whitespace warnings
are not product bugs.

Direct-spawn tracking ends empty and scratch cleanup was awaited. This does not
prove arbitrary descendant enumeration. All root-delegated CLI workers preceding
this handoff had exited. This handoff worker creates no background jobs.

## Next candidate steps

1. Receive the exact committed candidate hash.
2. Execute the exact refined-v2 frozen inputs.
3. Replay the installed-package holdouts through the installed module path.
4. Retain the old strict-red evidence and every new failure.
5. Make no product repair without root authorization.

These are future-candidate verification steps, not work executed by this
handoff.
