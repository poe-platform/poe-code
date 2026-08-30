# DATA validation — diagnosis v1

Completed August 28, 2026 using bounded filesystem reads, Node builtin byte/hash/
gzip/JSON helpers in the persistent data REPL, and direct Git metadata commands.
No archived/frozen/product module was imported or executed. No build, compiler,
native utility oracle, network, new test execution, product capture or retry.
No helper spawned a subprocess. No investigator child sessions remain open.

## Authenticated inputs and joins

1. Confirmed the owned subtree did not exist before creating FINDINGS.md with
   apply_patch. Checked repository root/status/index; foreign untracked artifacts
   remain untouched. Read applicable current instructions without copying their
   bodies into an artifact. Findings were written before supplementary validation.
2. Direct Git metadata resolved authority commit
   `42e2529034a1a39d7c23945c3bfb22b228df180f` and its exact RESULT-SEAL path to blob
   `bdc7a53db272b036f3bd916e9c3ebc4d1a0a8fd9`. The local seal's recomputed Git
   blob ID matches. Six exact candidate module paths resolved to the blob IDs
   listed in BINDINGS.json and matched independently recomputed archived bytes.
   No displayed/C-quoted filename inventory was parsed.
3. Checked every RESULT-SEAL.files entry: **207** regular files with exact length,
   SHA256 and recorded mode. Checked **199** CAPTURE-MEMBERSHIP entries against
   corresponding `evidence/` seal bindings and exact evidence-directory membership.
   Explicit runtime/execution-seal SHA256 fields were checked as well; those two
   files are direct hash references, not RESULT-SEAL.files entries.
4. Decoded the archive as base64 -> bounded gzip -> JSON only. Compressed identity
   matches FINAL and BINDINGS.json. Checked **2231** inventory entries, exact body
   membership for **2078** files, every decoded length/SHA256, and **14,210,103**
   decoded file bytes. No AGENTS body is in archive.files. Paths are relative and
   reject parent traversal. No extraction to disk was needed.
5. Recomputed the **1243-entry postbuild source subtree** after stripping exactly
   the `source/` prefix and excluding its empty root entry. SHA256 of its original-
   order JSON serialization matches `23b81cea…1d23c3b` and runtime sourceInventory;
   it also equals FINAL.sourceAfter. This is not FINAL.sourceBefore (prebuild).
6. Checked all **274** FINAL.sourceInputs against archived bodies: length, SHA256
   and Git blob SHA1 over `blob <length>\0<body>`. The six module sources are from
   candidate58be2d6c; supporting Shell/Memory source revisions are explicit in
   BINDINGS.json, not mislabeled as six-module edits.
7. Checked the independently listed six module names in every one of the **nine**
   captured product load lists (**54** app-load bindings) against runtime-seal
   size/hash/mode and archived source and physically-moved package JS bodies.
   This rechecks recorded identity; it does not independently observe execution,
   prove compilation correspondence or claim all 882 package files were loaded.
8. Matched frozen worker, loader, bootstrap and both matrices against runtime
   harness hashes and archived source-consumer/physically-moved copies. Fixture
   contents and worker predicates/scheduling were read as data, not evaluated.
9. Reassembled **nine** product streams using receipt fragment names, membership,
   decoded lengths/SHA256s, canonical base64, channel/offset continuity,
   channel-total and receipt-total byte counts, and complete stdout/stderr hashes.
   Parsed **378** case records. Compared FINAL case summaries while preserving
   its actual schema: FINAL retains kind/status/failures/reason/qualification but
   omits raw. This omission is not missing raw capture: raw remains in JSONL.
10. Recomputed per-layout status counts with no changed expectation and matched
    POSTRUN exactly. Checked **2142** nested captured byte payloads for canonical
    base64/length/SHA256. Located all **15** targeted records with exact JSONL
    byte ranges/line numbers/hashes in BINDINGS.json. S54/S62/S64/S71 are byte-
    identical across layouts; source/installed S74 are also byte-identical.

## What these checks do not establish

- Hash and join checks are DATA validation, not new dynamic tests or acceptance.
  No frozen assertion was rerun. The combined 346/11/18/3 observed and
  346/11/62/3 all-obligation counts are preserved, not rescored.
- Exact evidence-directory membership was enumerated at validation time and
  rechecked before commit, detecting new entries there at those instants. This is
  not an append-proof repository snapshot, lease or arbitrary concurrent-write
  guarantee. Historical/report/product files were not changed.
- No full new 50002-path Git tree reconstruction, all555 prerequisite replay,
  independent compiler correspondence or complete 1953-load audit is claimed.
  The source/body and six-module checks above have their stated scope.
- S64 rejection name/message/identity and S74 stat-return/timestamp values were
  not captured by the worker. Source-based explanations retain those limits.
  S54 had no dynamic raw payload and contributes no timing/abort/memory proof.
- Controller moved-types EEXIST, unrun43 jobs and operator all-owned peak>=3
  violation remain unchanged. Exact all-owned maximum remains unmeasured.

## Investigator helper corrections

The initial shell read helper used zsh's reserved `path` variable, causing cat/rg
lookup failures; it made no evidence changes. One exploratory REPL expression
had a syntax error. An initial Node deepStrictEqual check compared cross-realm
array prototypes; it was replaced by exact JSON-data equality for JSON-derived
values and string inventories. An exploratory FINAL join initially assumed raw
was present and omitted kind; the schema was inspected and the correct projection
was then checked. These are investigator DATA-helper corrections, not product
failures, new product attempts, or repairs to frozen evidence.

## Next author action

Poincare/root can use FINDINGS.md directly to separate (1) S62 diagnostic policy,
(2) S64 eager Shell input ownership, (3) S71 missing trace mode, (4) S74 deterministic
metadata/byte branch fixtures, and (5) S54 cooperative work/allocation admission.
Any product/fixture successor requires its own ownership and authorization; this
consumed attempt cannot be continued, rescored or retrospectively accepted.
