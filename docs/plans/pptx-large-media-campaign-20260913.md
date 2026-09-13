# large-media-512MiB campaign — September 13, 2026

Documentation/evidence only. Executed the named large-file campaign from
[pptx QA](pptx-qa.md), not the complete pipeline. No product code, README,
download, native document runtime, render, application playback, push or release.
Root AGENTS.md applies; no scoped AGENTS.md was found beneath docs or the inspected
pptx/office-package packages. The shared CLI/SDK contracts and format sections
7–9 govern admission, cancellation and unchanged parts.

## Inputs and authority

The exact manifest input was
`.cache/pptx-corpus/earth-system-media-large.pptx`, 457,525,505 bytes, SHA-256
`f1129e557eed26e1b84aaf3f1f422449ecb7b4e60c8f99dad42fceefeb1097a1`.
Independent Python zipfile streaming read all 44 entries with CRC verification:
457,606,963 actual expanded bytes. The manifest original remained immutable.
Existing retention permits disposable local QA, not redistribution. No publisher
text, imagery, video or template was copied into permanent regression assets.

Execution began at local main `0a3bd54491fa38c9bdb1e7805f289bd77bf1c774` with
unrelated dirty implementation files, including command-engine, metadata and media
work. These were neither edited nor staged. Source was loaded through Node's tsx
loader from the public `packages/pptx/src/index.ts` export surface, not a clean
released build. A source-hash observation was taken after execution began; it is
not a pre-import snapshot. This limits exact clean-commit reproducibility.

Host: macOS 26.4.1 arm64, Node v22.23.2, 24 GiB physical memory. No imposed process
RSS ceiling or benchmark isolation. Command runs were sequential in one process;
RSS measurements are OS process high-water marks, including imports, caller-held
input and previous runs, not isolated incremental engine allocations. The SDK
repeat used a separate process. Elapsed operation times exclude initial host file
loading; cancellation timing includes the command's admission work.

The host explicitly read the immutable file and passed Uint8Array bytes through
an in-memory command input callback. The callback intentionally returned the full
bytes even for default admission, testing the engine's own limit. Publication
callbacks wrote only enumerated disposable output files after completed engine
publication requests. No product host path access or network authority was given.
These are public command-engine and SDK tests, not a safe-bash shell/VFS adapter
or live model factory campaign.

## Effective ceilings and observed enforcement

Default byte input and archive ceilings: 268,435,456 each. Default individual
entry ceiling: 268,435,456. Raised profile changes only those three physical
context fields to 536,870,912; the entry ceiling represents the media allowance.
The current context cannot distinguish media from other binary entry limits.

Both profiles retain expanded total 1,073,741,824; 50,000 entries; XML 33,554,432
bytes/part, depth 256, 5,000,000 nodes; output 536,870,912. Adapter arguments are
bounded at 65,536 bytes; byte chunks 1,048,576 and maximum reads 1,000,000.
Additional archive limits: path 4,096 bytes, depth 256, PAX 1,048,576 bytes,
text 33,554,432 bytes, chunks 1,048,576. Relationship limits: 33,554,432 bytes,
50,000 parts, 1,000,000 relationships. Exact context is retained in the receipt.

The specified 5,000-slide and 250,000-shape ceilings are not configurable fields
of this execution context. The many-slide probe below demonstrates the former
is not enforced. Per-operation cumulative XML/clone accounting, combined
diff/merge/batch work and the 1,000-batch-operation ceiling were not established.
No image decoding occurred, so the 100-megapixel decoding limit was not exercised.
Do not describe this as complete default-profile conformance.

## Executed operations

1. Verify manifest hash and every entry CRC/hash independently before operations.
2. Run `inspect /input --json` with default context: exit 4, `resource-limit`,
   phase admit, affected 0, no publication. First limiting resource is input
   bytes, not the oversized individual media part. Elapsed 7.763 ms.
3. Use the separately constructed raised host context for `inspect`: exit 0,
   affected 0, no publication, 23,451.818 ms. Do not attempt to raise host authority
   through command `--limit`; those flags may only lower supported ceilings.
4. From unchanged input, run `properties set /input --name title --value
'QA review' --output /result --json`: exit 0, affected 1, one publication,
   137,174.406 ms. Output is 457,525,244 bytes, expanded 457,606,949.
5. Independently from unchanged input, run `notes set /input --slide 1 --text
'QA playback cue' --output /result --json`: exit 0, affected 1, one publication,
   95,995.087 ms. Output is 457,524,382 bytes, expanded 457,603,917.
6. Repeat title setting through exported `mutateProperty(input, 'set',
{name: 'title', value: 'QA review'}, context)` with identical raised limits.
   Complete output bytes matched the command output: SHA-256
   `cf1c304ccb821079e229f624de1a90e84cd6b2d505666970e52d56568a73a037`.
   SDK elapsed 93,625.001 ms; its process peak RSS was 4,652,048 KiB.
7. Request cancellation after 20 ms during raised inspection. Exit 130, no
   publication; abort delivery at 1,704.233 ms, completion at 1,705.536 ms,
   delivery-to-completion 1.303 ms. Stdout and stderr are empty despite `--json`.
   Report timer-delivery delay separately from cancellation response latency.

The command sequence's maximum RSS was 4,675,648 KiB (about 4.46 GiB).
Read high-water was 2,804,144 KiB; the fresh cancellation process peaked at
1,923,776 KiB. One observation does not establish a universal performance bound.
Schema discovery for properties set, notes set and capabilities returned exit 0;
this does not validate every advertised capability.

The first measurement command assumed cancellation produced JSON and its receipt
parser failed after receiving empty stdout. The product had already returned;
this was a measurement error, not a product crash. The fresh cancellation run
captured raw streams and reproduced the empty-envelope result. An initial
serialization probe used an invalid leading-slash member name and rejected before
cancellation; the corrected relative-name probe below supplies the valid result.

## Independent integrity checks

The title mutation changed only `docProps/core.xml`; its title reads `QA review`.
Independent tree comparison outside that title element is unchanged.
No entries were added or removed. All 43 other entries have exact baseline hashes.
The notes mutation changed only `ppt/notesSlides/notesSlide1.xml`; no entries were
added or removed. All other 43 entries have exact baseline hashes. Independent
ElementTree comparison outside the speaker-body shape is equal. The target is
slide position 1, slide ID 256, presentation relationship rId2; speaker-body
shape ID 3, placeholder idx 1. Slide-image shape 2 and slide-number shape 4 remain
unchanged. No source wording is retained in this report.

Both results retain these exact media identities:

| Part                 |       Bytes | SHA-256                                                          |
| -------------------- | ----------: | ---------------------------------------------------------------- |
| ppt/media/image1.png |   3,869,786 | 5bca33ef501eb2517b385d6d6d32250795ecb6706636beacef7437a7c411082a |
| ppt/media/media1.mp4 | 453,608,531 | f8ba554172faba15a61ed429cc40f30c78adc71864ae3d157a3d3c588c8646cd |

Structural retention passes for these explicitly checked closures. Independent
OOXML schema validation, rendered comparison, native application opening and
playback remain not run. Unchanged media bytes do not prove playback compatibility.

## Original stress and regression reductions

These fixtures were authored locally, not downloaded large documents. They remain
disposable and are not shipped or used as download-dependent unit fixtures.

- Expanded boundary: a ZIP containing one original 1,048,576-byte zero payload,
  compressed to 1,033 member bytes. The internal package reader returned exactly
  1,048,576 bytes at that total limit (38.524 ms); a 1,048,575-byte total limit
  rejected with resource-limit (1.614 ms). This is a package-layer check, not
  public Presentation admission of a complete deck.
- Slide-count finding: original minimal graph with 5,001 separate slide parts,
  5,005 entries, 2,031,133 expanded bytes. Public inspection returned exit 0 and
  exactly 5,001 slides in 13,774.222 ms, peak RSS 291,536 KiB. It should reject at
  the specified default. Future original regression: an in-memory two-slide
  graph with explicit host maxSlides=1 must fail before publication; maxSlides=2
  must pass. Until that limit exists, retain the 5,001-slide generation recipe
  as concrete evidence. Do not introduce a 14-second unit test.
- JSON cancellation finding reduced to an original empty 4,078-byte deck. Abort
  in the supplied read callback, then inspect with --json: exit 130, zero output
  bytes on both streams and no publication. Original regression expectation:
  parse an eight-field version-1 failure envelope, cancelled code, affected 0,
  data null, exit 130 and unchanged destination. Current behavior fails the
  shared JSON contract; no product fix is claimed.
- Serialization cancellation: write one original 1 MiB zero payload using the
  internal package writer, relative member name payload.bin, compression auto,
  explicit zero-delay host abort. It rejected cancelled in serialize at 6.430 ms,
  0.978 ms after delivered abort; no output package was returned. This complements
  large admission cancellation without claiming cancellation at every phase.

These are executed ad hoc reductions and precise future TypeScript regression
obligations, not newly committed executable tests. Product code changes are outside
this task. The large timer-delivery delay needs a separately instrumented yielding
investigation; fast response after delivery does not erase that observation.

## Accounting, validation and retained artifacts

The [API/case entry-gate reconciliation](pptx-large-campaign-api-reconciliation.md)
retains every upstream variant and public API identity. It does not close the
2,585 pending semantic case reviews, unregistered routes or unsupported public
members. Exact J01–J10 mappings and existing standalone notices remain applicable.
No reference identities enter product code, test names or generated fixtures.

Focused maintained Vitest execution passed 170 byte/package/notes/property tests;
the separate freeform reconciliation passed seven tests. Prettier and explicit-file
diff checks cover the documentation deliverable. No whole-pipeline execution or
visual CLI change occurred. All 13 other manifest fixtures were not selected for
this named large-file campaign, not counted as tested.

Durable measurement receipt: [large-media-campaign-20260913.json](../pptx/large-media-campaign-20260913.json).
The owned disposable directory is `.cache/pptx-corpus/qa-large-20260913/`; its local
wildcard .gitignore covers receipts and outputs, verified with git check-ignore.
Only the two derived large packages and two original stress archives were created;
the SDK repeat is hashed in memory. No renders, extracts or application saves.
The receipt enumerates every retained file. Keep these files while findings are
active; delete only these owned outputs after regression follow-up. Never stage
the original corpus or ignored outputs. Commit documentation separately from the
API reconciliation; no push or release.
