# Historical Mode Authority Correction Specification

Status: Proposed

Implemented Through: Not applicable

Purpose: Define the exact additive data-inspector correction without granting candidate execution or changing the accepted YQ policy.

## Normative Language

MUST, MUST NOT, REQUIRED and MAY define conformance requirements. Implementation-
defined choices MUST be recorded before the new bounded data audit.

## Problem Statement

The immutable v1 packet at `90a633e89d35085183a1d57716451438335b93f3` records a
0.922-second, reaped, exit-1 inspection. It wrongly compared complete POSIX mode
bits with Git's normalized `100644`. The exact original actual-review seal binds
`raw-compound/COMPOUND-RESULT.json` to mode `0600`, not `0644`. That original
failure, preseal and raw capture MUST remain FAIL and MUST NOT be rewritten.

## Goals and Non-Goals

The corrected inspector MUST authenticate immutable per-path mode metadata and
independent Git blob/type/executable-class identity. It MUST retain complete
before/after bytes, full POSIX modes, files and directories, including additions.

The inspector MUST NOT chmod historical files, omit an unverified file, substitute
actual stat values as expected modes, infer full permissions from Git class,
weaken candidate archive requirements or execute any product/harness cohort.
The existing selected source policy, normative 194 records/eight overlays, CARRY,
public caps, consumers/runtime APIs and original actual-review results are unchanged.

## Authority Model

`MODE-AUTHORITY.json` names exact commits, paths, raw SHA-256, lengths, Git blobs
and JSON pointers. The inspector MUST authenticate those identities before using
their data. Expected file modes MUST come from original seals or authenticated
committed evidence entry metadata, never current filesystem observations.

For the original candidate and build scopes, self-excluded seal files have separate
committed entry records in old build inputs and actual build-proof metadata.
The old actual seal's self-file is authenticated by the committed handoff index's
complete tree digest. Reconstruction uses the original committed extractor's
declared self-file mode and serialization, without running the extractor. A digest
mismatch MUST reject that authority before reading the corresponding live tree.

The compound result MUST use the original actual seal's exact entry, including
mode 384, length 64460 and SHA-256
`f70f554c513e6a52c45496cf515c20cd796591c37e5eea2aa155e32fbac9f8a8`.
Every other historical file MUST retain the same per-path authority requirements.

The prior b8 v1 self-excluded `FINAL-SEAL.json` has no located committed full-POSIX-
mode record. The inspector MUST reject its golden-mode admission as
`MODE_AUTHORITY_MISSING`, not manufacture a record. Its committed bytes, Git class,
full observed mode and complete before/after membership remain checked. That
explicit rejection MUST survive in the final result; observations do not supply
the missing original-mode authority and MUST NOT be reported as full admission.

## Validation and State Transitions

Git `100644` means regular nonexecutable; `100755` means regular executable.
The checker MUST compare that class independently of complete POSIX mode bits.
It MUST compare actual bytes to Git blob identity and sealed SHA/length, and actual
full mode to the authenticated per-path mode. Missing entries, changed bytes,
wrong modes, wrong Git identity, unknown types or changed directory membership
MUST reject the corresponding identity check. No error is repaired by mutation.

The only authorized new checks are static/data checks. Defined in-memory controls
MUST demonstrate acceptance of the sealed 0600/Git100644 combination and rejection
of wrong mode, missing authority, missing entry, changed bytes/length, wrong blob,
wrong type and unexpected executable class. They MUST NOT invoke a proposed
executor or load candidate code.

An absent historical mode authority leaves admission DENY. Inert source/package
data authentication MAY finish and produce proposed receipts while that denial
remains explicit; this is not an admission waiver or product execution capability.
Any other unexpected audit failure MUST be captured and stop the bounded attempt.

## Candidate Data Boundary

Raw source archive and full package hashes MUST match the root's exact b8/644/065
bindings before bounded regular-entry parsing. The existing inspector's selected
Git composition, archive safety, baseline README/package comparison, 846+24 exact
member comparison, source/entry/import identities and compact full-map references
MUST remain unchanged except for the new owned output path.

Source authority and source/full receipts MUST bind the new origin, never mutable
HEAD, a fabricated composite commit or an old active 35da candidate pin. A bound
author build receipt MUST remain AUTHOR_ARTIFACT_BINDING_ONLY, independently
compiled false and root-trusted false. No receipt grants execution by itself.

## Test and Validation Matrix

| Requirement | Data-only evidence |
| --- | --- |
| Minimal correction | Exact v1/v2 inspector diff and immutable original reference |
| Original 0600 authority | Authenticated original seal entry and independent Git blob/class |
| Strict rejection | Ten defined in-memory mode/identity controls |
| Whole historical preservation | Complete before/after file/directory hashes and modes |
| Missing original self-file mode | Explicit DENY entry; no expected-from-actual substitution |
| Candidate binding | Raw hash before tar parsing and full source/package map comparison |
| No execution | Zero product/compiler/type/native/proposed-executor counters |
| Document quality | write-spec checker; not a product result |

## Conformance Criteria

The correction is conformant only when all available authorities authenticate,
defined controls reject their exact bad data, the original failure is preserved,
and any missing authority remains a recorded DENY. Complete data maps do not imply
complete historical-mode admission, independent compilation or semantic acceptance.

## Open Questions

The prior v1 self-seal's missing original POSIX-mode authority remains a concrete
binding gap, not a reopened language or cap policy. Root must route any exact
additional authority. Fresh consumer/loader/runtime/integration/build-source seals
and an explicit successor GO remain required before any actual product review.
