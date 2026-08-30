# Validation record — 2026-08-27

## Executed checks before sealing

- `node extract.mjs extract`: final attempt exited 0 and created only new
  `CASE_MATRIX.json` and `CASES.md` through `apply_patch`. Matrix SHA256 is
  `ae334dcecc459d59e89d0183067b828ae4848ef48db300391dbe0971ec6046d2`.
- `node extract.mjs check-extraction`: exited 0. Reconstructed matrix and readable
  cases from immutable Git objects compare exactly to their frozen bytes.
  Authenticated 73 replay-manifest files plus complete manifest-inclusive inventory,
  237 candidate source files plus full source inventory, four build inputs, original
  8-file and extension 16-file freezes across original/candidate/evidence commits.
  This mode checks input authentication and deterministic output, not the not-yet-
  created owned seal.
- `node audit.mjs`: exited 0. A separately written literal-case audit checked all
  27 requested rows, exact argv/bytes/status, explicit virtual/native environments,
  native pathname and argv0, correction separation, controls and classifications.
  It rejected all 10 deliberate **in-memory evidence mutations**: dropped control,
  Unicode normalization, pathname-as-argv0, shortened executable pathname, native
  env mislabelled as virtual, C.UTF-8 substitution, lost help trailer, changed
  stderr hex, refusal relabelled as control, and correction replacing original.
  These are extraction integrity controls, **not product semantic test passes**.
- `node --check extract.mjs` and `node --check audit.mjs`: exited 0.
- `git diff --check -- tests/commands/expr-stress/c-profile-gap-review/frozen`:
  exited 0. This initial command preceded staging; the staged whitespace check
  is performed separately before the commit.
- Historical diagnosis text at commit
  `7f22cb8c13d5520f870585ab0d1b476083a213bc` was read through `git show` and hashed
  with `shasum -a 256`: `f1f58a028a5cc64e8f2e4877e525ea44f78943368235b572e537796ceb6e86b4`.
  It matches the independent replay's preserved diagnosis provenance. No diagnosis
  executable was run and no historical capture was promoted to 27a acceptance.

Repository-root command paths use
`tests/commands/expr-stress/c-profile-gap-review/frozen/` for the two scripts.
Observed local tools: Node `v22.22.2`; `git version 2.50.1 (Apple Git-155)`;
the supplied `apply_patch` command. A tool checkpoint was
`2026-08-27T18:39:16Z`; it is not a start time or claimed work duration.
Primary reference consultation used `web.run`, recorded in `PRIMARY_SOURCES.json`.

## Pre-freeze investigation/extractor mistakes, not product observations

1. An inspection command guessed `replay/native.mjs`, which does not exist.
   The actual native driver is `replay/review.mjs`. A separate inspection guessed
   an original `freeze-manifest.json`; the original manifest actually resides in
   `frozen/evidence/original-20260827/manifest.json`. Git reported missing paths;
   neither mistaken path supplied evidence or changed any file.
2. The first extraction attempted to buffer a complete `git archive --format=tar`
   for 27a with a 256-MiB buffer limit. Git output exceeded that limit and
   `execFileSync` returned `ENOBUFS`, signal `SIGTERM`; no output matrix had been
   created. The synchronous child was awaited and no archive file was written.
   The extractor no longer regenerates the complete archive. It authenticates
   the committed staging receipt and checks all candidate source/build-input
   bytes directly. The tar SHA256 is explicitly **historical**, not a successful
   new archive regeneration claim.
3. The next extraction attempted strict UTF-8 display decoding while processing
   all historical comparison rows; some C-profile output bytes are not valid
   UTF-8. It stopped with `ERR_ENCODING_INVALID_ENCODED_DATA`, before matrix
   creation. Display decoding now keeps `utf8:null` plus exact base64/hex/length
   for invalid sequences, never replacement-character normalization. The requested
   rows were subsequently checked losslessly against literal expected bytes.

No frozen matrix existed until the successful third extraction. The matrix has
not been rewritten since that freeze. These mistakes changed
only this new extractor before its evidence-only commit; they did not change any
product, historical input, original failure, native receipt or comparator criterion.

The first sealed verification and repeated exact-case audit both exited 0. The
subsequent staged whitespace check reported one extra blank line at the end of
`CASES.md`, outside all displayed tuples. Before the first evidence commit, that
display-only blank line and its generator were corrected, and this new owned seal
was explicitly refreshed. Matrix bytes and all original input/capture bytes are
unchanged. This is not stderr or captured-newline normalization. The final sealed
verification and staged whitespace check are repeated after that correction.

## Seal and handoff procedure

After this record is added, `node extract.mjs seal` authenticates the inputs again,
checks matrix/case bytes and creates a new manifest through `apply_patch` without
overwrite. `node extract.mjs verify` then checks that seal and all input/output
authentication read-only. The exact final verification/commit result belongs in
the requested `/tmp/expr-gap-matrix-candidate.txt` handoff, rather than recursively
rewriting a sealed record. The final commit stages only the eight explicit owned
files and uses `git commit --only` with those paths.

There were no product/native executions, builds, dependency installs, subagents,
workers, owned scratch directories, or calls into a live product tree. All spawned
Git/apply_patch commands have synchronous awaited completion. The two task-owned
`/tmp/expr-gap-matrix-*.txt` handoffs are deliberately retained for coordination.
Other owners' native artifacts, staged changes and concurrent sources are untouched.

Pre-correction owned seal SHA256: `3985e33dd82c857ea809cced05bcf658520314571efadda6e484c4d7aaecbde5`. It authenticated
the pre-formatting display artifact; it is not the final seal.
