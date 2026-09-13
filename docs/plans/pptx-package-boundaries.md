# pptx package-boundaries review

Scope: the documentation-only `package-boundaries` milestone in
[the pipeline plan](pptx-typescript-safe-bash.md). No product implementation,
whole-pipeline execution, README changes, fixture acquisition, push or release.

## Agent procedure

1. Read root and applicable scoped policies, the format/shared contracts and the
   existing test/API audits and inventories. Inspect actual ZIP, compression,
   XML, VFS and plugin declarations before deciding ownership.
2. Check for a completed document utility and avoid depending on pending work.
   Record current code hashes and specific limitations rather than claiming reuse
   has already been implemented or tested.
3. Define the minimal extraction, capability and publication boundaries in
   [architecture.md](../pptx/architecture.md). Keep all behavioral obligations in
   the existing ledgers and original wording in target cases.
4. Verify exact source-row correspondence, parameter totals, public API closure,
   operation bindings and false execution flags. Record a hash-bound metadata
   receipt; do not execute reference runtimes or download fixtures.
5. Run scoped maintained Prettier, the format-spec checker and `git diff --check`.
   Review the staged diff and commit only explicitly owned documentation files.

## Validated findings and decisions

The source ZIP codec explicitly rejects ZIP64; this conflicts with proposed F01
if it is reused unchanged. Its byte parsing/compression is the reuse candidate;
its shell command/publication helpers are not. A small shared engine extraction
with an explicit ZIP64 read profile avoids a duplicate archive engine. No product
bug was fixed and no current archive command support promise was changed.

The XML parser normalizes line endings and does not retain document-level comments
or processing instructions outside the root. Untouched parts must retain original
bytes, and dirty-part serialization needs preservation evidence. Existing staged
file APIs are useful, but atomic rename alone cannot prove fingerprint-conditional
publication. These are concrete architectural gaps, not failing product QA.

The API map's pull-based byte source differs from the shell async-iterable source.
The architecture resolves that documentation ambiguity with an explicit transport
adapter, retaining the public map's spelling rather than silently changing it.
No docx implementation was found; only audits/specification/planning evidence.

## Original TypeScript acceptance designs

All cases below are **specified, not implemented or executed**. Fixtures are tiny
original in-memory packages about a seed library. Expected records are authored
independently of the encoder under test. These supplement, never replace, the
3,673 source cases and 391 counterpart obligations.

| Case ID                    | Arrange and action                                                                                                                                                                                   | Required observable result                                                                                                                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| compact-wide-directory     | One stored `seed.txt` entry containing `A`; use ZIP64 extra/EOCD fields for tiny legal sizes and offsets, with ordinary/ZIP64 descriptor variants. Read under the bounded presentation profile.      | Read `A`, verify CRC and canonical entry identity; reject inconsistent wide fields, multi-disk fields and out-of-budget decoded sizes before publication. Existing ordinary ZIP acceptance remains. |
| borrowed-input-isolation   | Admit bytes for an original one-slide deck; overwrite the caller array immediately after the async call and reuse a producer buffer on its next read.                                                | Loaded text and fingerprint match the initial admitted bytes. A changed returned part buffer does not mutate the model.                                                                             |
| checksum-before-output     | Supply a one-entry deflated package with a wrong CRC, then save through a recording sink.                                                                                                            | CRC failure is detected even when XML inspection could finish before the last decoded byte; no output write occurs.                                                                                 |
| outer-xml-retention        | Author an XML declaration, comment before root, processing instruction after root, unknown namespaced attribute, CDATA and CRLF text. Edit an unrelated part, then a supported sibling in this part. | Unchanged part bytes are identical. Dirty serialization retains miscellaneous nodes, namespace meaning, content order and semantic whitespace; no entity fetch or loss of unknown content.          |
| conditional-content-change | Admit a destination then change its bytes while retaining inode identity before publication; also replace its parent identity in a second variant.                                                   | Conditional commit fails with stale/publication detail and leaves the competing bytes intact. Force does not bypass the refusal.                                                                    |
| output-set-refusal         | Split two original slides through an adapter advertising only single-file staging.                                                                                                                   | Refuse before writes unless partial output is explicit. With partial output authorized and the second write failing, report exactly the first published file and preserve existing unrelated files. |
| pull-source-progress       | Adapt shell chunks containing empty chunks and a reused backing buffer to SDK reads of at most three bytes; cancel while awaiting a chunk.                                                           | Preserve byte order and snapshots, enforce chunk/work limits, distinguish null EOF, terminate the iterator on cancellation and do not leak a pending publication.                                   |
| inspect-without-creation   | Inspect an original slide with no notes part, then explicitly access its creating model notes property.                                                                                              | CLI inspection keeps graph/fingerprint unchanged; the model getter creates the required owned graph. Both behaviors remain available under their separate contracts.                                |
| inert-linked-media         | Original picture relationship targets an external HTTPS location; no VFS or network capability is supplied.                                                                                          | Inventory preserves the target as metadata; no fetch, host lookup or runtime activation occurs. Replacement requires explicit admitted bytes.                                                       |
| portable-byte-roundtrip    | Open, edit and save the original deck using only byte capabilities under browser and workerd export conditions.                                                                                      | Equal domain results, correct async errors/cancellation, no host/native imports or downloads; missing publication capabilities are reported rather than invented.                                   |

The first, third and fourth cases reduce observed implementation gaps into small
regression designs. No external corpus asset is copied into them. Runtime failures
in future QA must gain their own independently authored regression and exact
execution evidence; these designs are not such execution evidence.

## Full accounting and remaining adaptation

The metadata receipt in
[architecture-evidence.json](../pptx/architecture-evidence.json) binds the inspected
files and current inventories. Each collected unit node and expanded BDD row is
checked by its inventory pointer, identity and source location, not just count.
The 2,407 API identities all remain in the 2,424-row target map and command map;
17 bounded views supplement them. Every API obligation has original acceptance
IDs, including members with no candidate source tests. No underscore-based
exclusion or architecture-only source waiver is introduced.

Current ledger statuses remain 167 reviewed original designs, 894 provisional BDD
designs, 2,611 unit semantic reviews required and one deferred public behavior.
There are zero executed target cases. The original audits' unmapped flags are
historical baseline acquisition status, not replacements for the current ledger.
The pipeline's separately edited statuses were preserved; this receipt does not
certify completion of `map-every-upstream-case` or any implementation task.

Reference names/links remain in research/provenance and the existing standalone
MIT notices. No substantial reference code was added by this review. The corpus
manifest is consulted as metadata only; no fixtures were fetched, shipped, changed
or deleted. Visual product QA is unrun because no CLI or product code changed.

## Validation and delivery

Passed: exact unit/BDD pointer, identity, location and order checks; all 2,057
parameter bindings retained; complete API identity joins and resolved SDK operation
bindings; original acceptance IDs and false execution flags; standalone MIT notice
presence. The receipt retains hashes of all inspected inputs, explicitly marking
pre-existing untracked inputs instead of treating them as committed evidence.

Passed: maintained scoped `npx --no-install prettier --check` on the three owned
files, `git diff --check`, and the write-spec `check_spec.py` check on the unchanged
format specification (zero warnings). No code tests apply to this documentation
change. Product runtime, packed-consumer, browser/workerd and visual qualification
remain future work. This milestone produces a local documentation commit only;
remote delivery and release are not authorized.
