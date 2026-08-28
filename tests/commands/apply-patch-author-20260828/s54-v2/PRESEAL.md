# S54-v2 finite pre-execution recipe

Source candidate: `753f33d2` (full identifier and six source hashes in SEAL.json).
Base inputs: unchanged authenticated coherent78 MANIFEST SHA-256
`4ecaed8c6fc04a90320482531ea50cc729a4ac52bcb88782922d0225417dc18e`,
selected tree `8437e4eda904e1248c25eeef0d9d455b1d251495`, plus only six
apply-patch module files. Four changed production files; options/index unchanged.
No current-HEAD product input. Original profile/cases/executor/evidence immutable.

One bounded attempt: 20 minutes overall, 32 admitted children including data Git
processes (one runner plus at most 31 children), peak at most four (serial commands,
loader worker and npm helper included), case 30 seconds, compiler 120 seconds.
Aggregate captured child bytes <=64 MiB; task-owned retained disk <=512 MiB,
checked before/after commands and cleanup. No claim of allocator/RSS or transient
disk hard preemption. Output maxBuffer bounded per child; integrity, timeout,
cleanup or tool failures stop dependent execution. Ordinary assertion failures
aggregate only after a completed safe summary. All captures retained, even failure.

## Cases and layouts

Run unchanged original 63 author cases and F01–F16 in each of source-build,
offline installed and physically moved **whole** package. Authenticate actual
loaded module bytes and admitted declarations; forbid source fallback/symlinks.
Original 882-package-file expectation remains. Original 63 is not Arch's original
32 or supplement70; their old results are not rescored here.

F01/F02/F14 real VFS edits with long lines, scalar boundaries, CRLF, final newline
and inclusive file caps. F03 four falsy/object caller identities from a real
scheduled host-read cancellation; F04 one admitted producer pull and exactly one
finalization; F05 raw sink reason with already-published bytes retained; F06/F07
work/file limits; F13 NUL/invalid UTF8 precedence. These run unmodified product.
F08/F09/F10/F11/F12/F15/F16 are explicitly private/prototype/allocator observations,
not unmodified scheduling, OS preemption or measured memory. No duration assertion.

Types in every layout: strict positive three factories/two types; deliberate
maxPatchBytes:string failure TS2322 (no TS2307); repaired positive. No root API claim.
Four emitted-source loaded mutants in moved package, each with actual changed
load hash and focused failure, then restored passing bytes:
1. M1 copyInto bypass: F08 detects bulk copied8197 bytes.
2. M2 nextYield increment8192: F11 detects missing8192 checkpoint.
3. M3 encode chunk16384: F10 detects large native encode call.
4. M4 remove staging work admission: F16 detects result allocation before refusal.
Two admission negatives: altered emitted bytes without manifest update, and .ts
source fallback. Restore and run F01 again. No native Codex/oracle, engine/private,
network, runtime dependency, whole gate or production subprocess.

Reuse original probe/loader/case bytes and existing composition manifest/inventory
format. Use one Git cat-file batch for data bodies, one NUL ls-tree for six-path
admission. No copied AGENTS/whole repository/archive. Temporary HOME/cache/npmrc
and temp Real fixtures only, offline development installer/compiler. Finish with
exact source/emission/pack/declaration hashes, child outcomes and owned-root cleanup.
