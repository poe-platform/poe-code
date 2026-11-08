# Path transport v2: DATA repair and future HOLD

This is a narrow versioned successor of actual-v1, not another actual attempt.
The original ad08d510 / 0297e41c HOLD remains 25 DATA / 68 NOT_RUN.
Candidate 58be2d6c5706f3e90f01d48e695ecfd9daa52669 and evidence
767b6729d3acac0dd17c42dfb9e0b93e6e9c4de5 are unchanged. All original32,
adversarial80, expanded94, limit14/28 and extra probes, SOURCEONLY concerns,
nonexecution gaps, loader permissions and read routes in the authenticated
actual-v1 profile remain binding. Its old GO is NOT authority for this successor.

Only DATA/SYNTHETIC and development Git metadata run during this repair. No
candidate source compile/build/import/install/runtime/mutant/nativeCodex/network.
Raw metadata includes instruction path names/modes/OIDs but no instruction bodies.
No archive, no source materialization, no product inspection is added.

## Reachable path consumers

- `capture-metadata.mjs` is replaced by `freeze-inventory.mjs` and sealed metadata.
  `ls-tree -rz --full-tree` retains every record; metadata header ends at the first
  TAB, path bytes at NUL. No human-display parser or C-quote fallback is reachable.
- `path-bytes.mjs` replaces both old controller inventory parsers and tree hashing;
  rejects malformed/truncated/duplicate/out-of-domain UTF8 records and conflicting
  directory/file entries. UTF8 is fatal and byte-roundtrip checked. NFC/NFD remain
  distinct, as do all spaces, TAB/LF/CR, quotes, backslashes and nonASCII names.
- Complete base and candidate metadata census includes ALL entries. Full-tree
  authentication happens before the separate unchanged 268+6=274 materialized
  source projection. Five overrides yield derived8437; it is not a stored object.
  Six candidate additions form another derived identity. No names are dropped to
  force identity. Instruction names are allowed in census, not materialization.
- Batch source requests now use authenticated exact blob OIDs, never newline-
  delimited revision:path spellings. Blob length/hash and selected mode/path
  binding stay checked. The fixed ASCII future runtime-seal Git path is unchanged
  except for the owned successor directory; no arbitrary pathname parsing there.
- `forensic-data.mjs`, admission capture/check scripts and matrix check scripts
  are historical inputs only, never imported/dispatched by this successor.
  `data-controls.mjs` replaces the historical display-decoding forensic route.
- `independent-tree.mjs` uses a separate bottom-up directory table and explicit
  Git byte comparator, independent of the repaired trie. Both must equal the
  authenticated stored candidate root, including all 98 formerly quoted names.
- Supervisor is byte-identical except adding raw stderr base64; capture keeps
  raw stdout AND stderr, hashes, bounded ordered fragments, exit and known cleanup.
  `worker.mjs`, `loader.mjs`, `bootstrap.mjs`, `guard-control.mjs`, `deadline.mjs`
  remain exact original bytes. Product fixture copies and permission argv do not
  change. JSON/URL routes preserve verified selected names; no locale conversion.

## Limits and future interface

Repair: 30 minutes total, serial metadata child10s, peak2 including coordinator,
capture128MiB/work512MiB. Admission accounting is not OS/RSS enforcement. No
silent cap increase. The original future110-minute deadline, child limits,
70 jobs, frozen882-package count and original post-build seal barrier remain.
There is no new provider policy, product grant, test relaxation or read route.

Future root must first inspect the independently reviewed committed DATA evidence
and give FRESH ROOT GO. Create `ROOT-GO.json` with authorization `FRESH ROOT GO`,
attempt 1, exact candidate and execution-seal SHA256. Then, once only:

`node tests/commands/apply-patch-independent-20260828/path-transport-v2/controller.mjs`

The controller refuses absent/mismatched GO before creating work or child state.
Unknown future build/package/app emissions are NOT assigned invented hashes:
the unchanged compiler/input recipe must produce full emissions, exact loaded
app/worker/loader/package hashes and mutation copies; commit RUNTIME-SEAL before
RUNTIME-START at the existing continuous-clock barrier. Execution seal binds
that derivation, inputs/tools, unchanged permissions and child capture. No old or
new runtime controller is invoked in this task. A failure stays additive; no retry
of a future runtime attempt is authorized by DATA success.
