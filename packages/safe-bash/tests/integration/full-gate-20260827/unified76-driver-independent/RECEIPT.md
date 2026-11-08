# Independent unified76 preparation receipt

**PRE-CANDIDATE / HOLD. All 22 control groups are NOT_EXECUTED.**
This is preparation and pinned-evidence review, not driver acceptance, public
acceptance, a gate execution, or a rescore of historical cases.

## Chronology and immutable first freeze

At August 27, 2026, 19:14:01 CDT (August 28, 00:14:01 UTC), this leaf observed
live author filenames and filesystem metadata. Author implementation files
already existed; `controls.mjs`, `seal.mjs` and profile artifacts were also
visible by filename. Their bodies were not read. Filesystem timestamps are not
authenticated authorship dates.

Phase A committed at August 27, 19:17:05 CDT, **before this leaf read any proposal
or driver body**:

- Commit: `7f98f745ffbf14da484ca3867ebf09cfa18841a2`.
- `PHASE-A.json` SHA-256: `c8df466748a048e91a7a28a0b83c58dca2f8fdba2773e359d7b647d51d41a37c`.
- Its requirements/control mutations derive only from the user brief and AGENTS.
- Correct chronology: **POST author-file existence / PRE implementation inspection**.
  This is not literal pre-code, pre-authoring, or blind-to-file-existence work.

Phase B subsequently reads pinned proposal/policies/manifests and historical
reports. No live or pinned successor implementation body has been inspected.
Phase A was not rewritten. Bounded Git blob hashing is distinguished from source
inspection or execution; no source snapshots or archive copies were created.

## Exact bindings recovered

- Proposal: `71bf8b4d30f015459bb4e888114e5eb6d323eae8`,
  `tests/integration/full-gate-20260827/unified76-proposal/PROPOSAL.md`.
- Selected product base: `44f00bf84278e3361b52106478d59c707ab7b2bc`;
  tree `5905cf8d43233c68ea2bd499275ada2641223d9a`;
  source tree `5876c6bf4ad9bc07f22cc46f8dbee99461981862`.
- Reported full-product pack SHA-256:
  `c109372f90b1bd19bcf756cf993bb2976fb52b75fe0c92a1cf96dab4c229b5cd`.
  Recovered from pinned evidence, not freshly hashed/repacked by this leaf.
- Historical independent freeze: `0895926bbf0f3cf1439c75f59e5505330afa1a39`;
  infrastructure `522e8e273573517ab8b854636bdd4589ee696c28` and calibration
  `c355751f36ca3fdbab8f888eaab30203c1bcd343` remain historical.
  Their 71 PASS / 7 NOTEXECUTED are not successor results.

`PHASE-B.json` pins all read evidence by full revision/path/hash, lists exact four
fixture paths/base hashes, supplies version76 questions for historical case IDs,
and records Node/native/cleanup identity sources. The final candidate/overlay
after-hashes and driver artifact remain unbound. Root-selected base ancestry does
not establish pending HTML/DU/expr public acceptance.

## Static finding: F01, not waived

The current-classified `tests/fs/webdav/consumer/provider.mts` has different
inventory and selected-base byte hashes:

- Inventory field: `288d17dca5b6950fababb945cf21c15594dfbf37897d1cdcaab2aba1088a6b9b`.
- Actual pinned base blob: `af9ffdb0f991696818512c5f50dab94fdb76387d3b66a2abca80fb799d6d30b6`.

Exactly one of the 192 MTS entries differs from its inventory SHA field; exact
192-path membership still matches. This is **not yet a proven driver/product
defect**: the authority of that field for `current` entries needs clarification.
Q2 asks Curie/root to bind actual selected runtime bytes and explain whether the
classification field is historical/advisory. No fifth fixture, product change,
or inventory rewrite is requested. Do not silently treat the old digest as the
runtime identity or describe all192 per-file hashes as matching.

## Read-only validation

Command, run only against preparation artifacts and pinned Git objects:

```text
node tests/integration/full-gate-20260827/unified76-driver-independent/integrityvalidation.mjs --verify
```

The first invocation exited1 at F01. A bounded follow-up hash audit completed
the remaining inventory/cleanup/staging checks. The final validator retains the
finding, finishes its static checks and **still exits1**, not green. Final output:

```json
{
  "status": "STATIC_BINDING_FINDINGS_HOLD",
  "candidateStatus": "PRE-CANDIDATE/HOLD",
  "controlsStatus": "NOT_EXECUTED",
  "driverInspected": false,
  "staticToolNode": "v22.22.2",
  "bindingFindings": [{
    "path": "tests/fs/webdav/consumer/provider.mts",
    "classification": "current",
    "inventorySha256": "288d17dca5b6950fababb945cf21c15594dfbf37897d1cdcaab2aba1088a6b9b",
    "baseSha256": "af9ffdb0f991696818512c5f50dab94fdb76387d3b66a2abca80fb799d6d30b6"
  }],
  "phaseASha256": "c8df466748a048e91a7a28a0b83c58dca2f8fdba2773e359d7b647d51d41a37c",
  "phaseBSha256": "f7919534015ef0ab3e253a3f4721197d93c7747314bcbce24c30e33b27484802",
  "evidenceBlobs": 12,
  "canonicalPathAndBlobIdentities": 632,
  "classifiedMtsBlobsHashed": 192,
  "cleanupBlobsHashed": 256,
  "stagedTypeBlobsHashed": 14,
  "baseFixtureBlobsHashed": 4,
  "historicalNativeManifestEntries": 51,
  "gitMetadataBytes": 5553168,
  "archiveBytesRead": 0,
  "runtimeExecutions": 0
}
```

Validator SHA-256: `a22c657444e0730f9837706712ad95d060fd0b895321bbc08238ffcd80242944`.
The local static-tool Node is not the required future gate Node24 profile.
Counts above describe static reads/comparisons, **not control pass counts**.
All256 cleanup and14 staged-input hashes match their pinned manifest fields;
all632 canonical path/blob identities match Git metadata. No runtime dependency
closure, source semantics, type coverage, native availability, archive extraction,
four-fixture reverse patch, package bytes or cleanup behavior was validated.

An earlier exploratory summary wrongly compared canonical `{path,blob}` objects
as strings. Its invalid provisional fingerprint/mismatch output, the corrected
comparison and the first F01 failure remain in the tool transcript and are
disclosed in Phase B. No historical failure or frozen expectation was rewritten.

## Root routing: seven bounded questions

Exact questions and control mappings are `PHASE-B.json` Q1–Q7:

1. Final candidate/base+four-overlay identity and separately frozen driver inventory.
2. Complete runtime closure/origins/classifications/output scopes, including F01.
3. Node/loader/permission/ordered-TAP argv, explicit `--run`, resource and cleanup limits.
4. Exact49+2 native assets/profile: 44 executable entries plus seven source/archive/docs,
   not51 unique binaries; failed prerequisites reject before suites.
5. Final256 cleanup envelope and COMMIT/EXPECTED binding, with registered-work awaiting.
6. Build-once/package lineage and exact76 smoke/consumer routes; c109 digest or declared change.
7. Diagnostic versus strict verdict policy, raw evidence, required counts and SafeJS availability.

The four fixture deltas are 73→76,73→76, public-with-custom74→77, and maintained
70→76. Exact path/byte proofs remain future work after routing, not presumed
correct. Counts632/192 and the proposal's corrected4579-file **typing-only**
selection are not full runtime closure evidence. Keep pending public acceptance
and historical outcomes separate.

No gate, driver helper, product import, build, pack, types, test cohort, native
oracle, dependency install, private write, AGENTS copy, or large archive buffer
occurred. All owned command sessions and awaited Git children have settled; no
background service was started. Foreign staging/artifacts were not changed.
Stop here for root's later immutable candidate/driver handoff.
