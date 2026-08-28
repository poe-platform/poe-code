# Final author profile v2 — pending different independent freeze

This is a design candidate, not implementation or acceptance. Read with
../DESIGN.md (full module-local API, CLI, selector/display and limits inventory)
and BYTE-TABLE-V2.md (exact byte proposals). This refinement supersedes conflicting
v1 proposals explicitly. V1 is bound to commit
91bcc1c9ec64e8e0bdb5db3055ee4c8609cd27a2, DESIGN.md SHA256
8e27ec025c8277cf4fe422d19f9582c2a1b0ab9f9a5577200a1e449703b11c75;
its original RECEIPT.md and every original oracle file remain unchanged.

## Authority versus proposal

Approved root policy: pinned default-start `slice -l0` means all records;
chunk invariance rather than unsafe SIMD lookahead imitation; faithful
cross-delimiter reserialization with explicit native byte differences; the seven
main logical defaults; observation-time guarded nontransactional -o using existing
contracts; explicit rejection of advanced flags/formats/color/expressions.
This is NOT blanket approval of the CSV dialect, all remaining numeric/grammar
restrictions, hard ceilings, malformed recovery or zero-tail source-kind behavior.

The proposed factories remain createXanCommand/createXanCommands/xanCommands,
options replace/limits, one `xan` definition, plugin `xan-commands`, four commands
headers/count/select/slice and h alias. They are not current public exports.
The exact accepted option and selector inventories remain DESIGN sections 2–3.
Reject unlisted options, expression/evaluation files, advanced formats and color
always before input/output acquisition; do not silently ignore them. --version
is explicitly unsupported in this candidate (no fake native version); root may
later authorize a product version. This narrows the old unresolved version choice.

## Slice: observations, source and candidate

Primary slice.rs run_default: increment i; skip while i<=start; write; only then
break if i==end. util.rs range computes end=start+len or supplied end. The
post-write equality explains these results without extrapolating from one call:

| argv suffix; input `a\n0\n1\n2\n` | stdout hex | Evidence / candidate |
|---|---|---|
| -l0 | 610a300a310a320a | original 23/24 establish default-start behavior on their shorter fixtures; source inference for this fixture; approved compatibility |
| -s1 -l0 | 610a310a320a | additional 01 observed; retain remainder |
| -s1 -e1 | 610a310a320a | additional 02 observed; retain remainder |
| -e0 | 610a300a310a320a | additional 03 observed; retain all |
| -s1 -l1 / -s1 -e2 | 610a310a | source inference, exact combinations unmeasured |
| -s3 -l0 / -s3 -e3 | 610a | source inference, exact combinations unmeasured |
| -L0 (stdin) | 610a320a | additional 04; forward reader retains final row despite zero request |
| -L0 a.csv | 610a | additional 05; regular-file reverse reader takes zero rows |

All observed rows above status 0, stderr empty. Source-only rows are predictions,
not observations or freeze approval. Original 22 covers a nonzero end with --skip;
original 25/26 cover index deduplication and nonzero tail on stdin.
Candidate ordinary ranges use the post-write stop rule: equal bounds and zero
length read to EOF after skipping start, NOT safe-empty early return. Range
overflow is rejected before I/O, not release-build usize wrapping. -s overrides
--skip as before. Conflicting/mixed modes remain explicit strict rejections.

Remaining root choice: candidate -L0 follows operand kind: stdin retains/emits
one final data row (none if empty), file operand reads header only (no data in -n).
This matches the two observed routes, but VFS file operands are not guaranteed
native seekable files. Applying the regular-file rule to every VFS file is an
explicit proposed portability rule, NOT measured remote/native equivalence.
No reverse/seek capability is invented. Retained occupancy for stdin -L0 is one
row and is charged normally; maxLastRows bounds occupied rows as well as request.
For positive -L N the bounded forward ring remains the proposal for every source.

## Raw versus decoded output

Logical cells are byte strings under the proposed command dialect, not a promise
that every other CSV dialect parses bare CR identically. Decode doubled quotes
exactly once. Count every logical field, including empty and trailing fields.
Cross-delimiter select ALWAYS serializes those decoded cells with the output
delimiter; no raw-field transfer. A one-field empty record emits `""\n`, two empty
fields emit `,\n` for comma. Quote delimiter/quote/CR/LF and double quote bytes.

Same-comma data raw preservation requires all of: supported well-formed lexemes
(balanced quotes, no embedded-unquoted/postquote junk); no delimiter change;
concatenating selected lexemes plus LF reparses to exactly the selected decoded
cell sequence, including field count and byte values; no BOM lost at absolute
output byte zero; retained spans owned before producer advance/finalization.
This is a semantic criterion, not permission for unbounded reparsing. Implement
with scanner flags and bounded work; independent freeze must prove equivalence.
Header records always use the decoded writer, not raw preservation.

Necessary counterexamples: comma source `a,x;y\n`, select column 1 into semicolon
output: raw `x;y\n` creates TWO fields, safe `"x;y"\n` preserves ONE. Source
`x,\uFEFFz\n`, -n select 1,0: native emits EFBBBF at output byte zero, so a fresh
reader strips the cell's BOM. Candidate emits `"\uFEFFz",x\n` instead. The writer
must force quoting of the first emitted cell beginning EFBBBF at absolute output
zero, including reordered decoded headers and slice; never insert a fresh BOM.
A bare lone CR at record start likewise cannot be raw-transferred if the selected
cell's bytes would be skipped. A single empty raw lexeme must be quoted.
These exceptions retain a deliberate byte gap to keep values; no universal
source-faithful/raw-native claim. Original incomplete quote row 21 is retained:
candidate normalizes supported unterminated EOF to a closed quoted field rather
than unsafe raw copy. That malformed recovery remains a root decision.

## Existing I/O binding (read-only inspection)

No general exported `guardedWriter` or identity-conditioned open exists in the
inspected contracts. Existing guarded publication composition is concrete:
split/outputs.ts Outputs.prepareInput/prepare, split/split.ts writeStream/writeFile
branch; copy-identity.ts compareObservedEntries; metadata/mktemp.ts exclusive wx;
filesystem.ts WriteFileOptions and filesystem.md identity/comparison rules.
Outputs depends on split Budget, tracks one input, and permits existing output
for borrowed stdin; it is NOT directly sufficient for xan's stricter/multifile
profile. Reuse the existing comparison primitive and FS operations in xan-local
composition after implementation approval, not split's private budget/ownership.
Curl network/output.ts writeOutput uses unguarded w and append fallback; it is
not an alias-safe guarded writer and is NOT an approved fallback for this profile.

Exact candidate sequence:
1. Validate factory options, all argv/numbers/modes/paths/limits, suffixes and
   input cardinality. Register invocation cleanup before resource acquisition.
   For -o observe all file inputs and destination with signal: lstat followed by
   stat for existing entries; reject directories/nonregular input/output.
   A dangling destination symlink is an existing entry, not a missing name:
   refuse ENOTSUP rather than resolving/recreating its target in xan.
2. Reject equal lexical paths; realpath equality can additionally prove alias,
   never distinctness. For existing destination require each file input's
   compareObservedEntries(fs,input,inputStat,fs,out,outStat,{signal}) == distinct.
   same => EINVAL, unknown => ENOTSUP; invalid/conflicting authority => EIO.
   Borrowed stdin plus existing destination => ENOTSUP. Complete identity or
   truthful comparison is authority; no bare inode, host-invented scope or URI
   inequality. A wrapper's future write target remains its responsibility.
3. Only after alias preflight, acquire input and validate required first headers,
   UTF-8 header display and selection resolution before destructive output.
   Headers reads all requested first records before file publication. Count
   can finish counting before writing its small result. Select/slice cannot
   validate unread body records before streaming publication: later malformed,
   limit, read, write or cancellation failure may leave partial/truncated files.
4. Output uses fs.writeStream(out, ownedBoundedSource, {signal, flag}), flag wx
   for observed missing, w for observed distinct existing. Await completion and
   use backpressure; a raced creator under wx is preserved. No precreate-empty
   followed by w or append, no check-then-write called atomic. Do not gate on a
   made-up capability or streamingWrite boolean. If writeStream is absent, a
   bounded whole-result fallback may use existing fs.writeFile with the SAME
   flag only after pre-admitting the entire payload in maxRetainedBytes; fail
   the limit before output publication if it cannot fit. No new fallback-size
   default and no append sequence. This concrete fallback is a v2 proposal,
   not previously implemented or an all-size streaming guarantee.
5. Do not pass an explicit mode: backend default new-file modes apply (real
   uses 0666 subject to host policy; WebDAV rejects explicit mode). The old
   blanket mode:0666 proposal is withdrawn to avoid disabling WebDAV. No chmod,
   mkdir, temporary output, rename, rollback or deletion of partial destinations.

No shared API blocker for this observation-time nontransactional profile:
existing wx/w writes and comparison contracts suffice. A guarantee that identity
cannot change between observation and destructive open WOULD be blocked: there
is no conditional-on-observed-entry open/lease contract, and root has not asked
for one. Do not invent it. The remaining restriction is capability availability,
not permission to claim all providers accepted:

| Inspected backend / operation | Concrete limit, without new matrix execution |
|---|---|
| memory/index.ts readStream/writeStream | available; storage itself retains file bytes outside xan logical occupancy |
| real/index.ts readStream/writeStream | configured-root only; write uses native O_EXCL for wx and closes handle in finally; path observation is not an ABA lease |
| s3/filesystem.ts constructor/streamWrite | streams exposed only with transport capability+method; wx needs conditionalPut, otherwise ENOTSUP; no-stream input unsupported; missing streaming output can use bounded writeFile only if conditionalPut permits wx |
| webdav/webdav.ts readStream/prepareWrite/writeStream | conditional wx uses If-None-Match:*; explicit mode unsupported; actual server compliance/identity authority not newly tested |
| mount/overlay/custom | forwarding/selected destination authority must be truthful; unknown comparison is refused; method presence is not deployed-service qualification |

Input with absent fs.readStream remains ENOTSUP (no unbounded readFile input).
readStream returns ByteSource, not an opened-handle lease or universal
cooperative-acquisition promise. Do not infer resource ownership from its type.
No host network authorization, credentials, provider provisioning or new shared
hook is introduced by xan. No provider integration acceptance was run.

Borrowed stdin: forward next() through an iterable with no return/throw before
readBytes; never return/cancel original stdin or acquire it for a no-input path.
Owned VFS iterators get invocation cleanup registered before acquisition; close
admission, release admitted cooperative work and share the same idempotent close
promise with finally/registerCleanup. Copy retained fragments before next or
producer finalization; transient awaited writes need not copy indiscriminately.
createOutputOperation(context,destination) precedes output acquisition; only
truthfully cooperative resources use acquire. stdout ownedOutput enrollment is
destination-specific; file and stderr operations root independently in caller
signal, never stdout-child scopes. Caller abort reason identity wins over mapped
FsError or local output-close; escaping errors are not converted to status 1.
Opaque host promises retain late-rejection observation but are not magically
drained/preempted. No cancel deadline/RPC/RSS/transaction guarantee is asserted.

## Accounting and validation freeze inventory

DESIGN section 6 retains EVERY prior default and hard ceiling, not new defaults.
Only maxInputBytes=256MiB, maxOutputBytes=256MiB, maxRetainedBytes=32MiB,
maxRecordBytes=8MiB, maxCellBytes=4MiB, maxRecords=1000000 and maxWork=1000000000
defaults are now root-approved. Other defaults AND all hard ceilings remain
declared proposals for root/freeze. All 19 limit fields remain in that table.
Parent shared limits always win. Positive safe integers only, <= corresponding
hard ceiling; reject unknown keys, explicit undefined values, invalid replace,
NaN/Infinity/fractions/zero/negative/unsafe values before I/O as already specified.

Totals aggregate across files and parse/resolve/emit/cleanup-diagnostic phases:
arguments, delivered input bytes/chunks (including empty chunks, BOM, read-ahead),
logical records including headers and skipped rows, work and all destination
output reservations. No reset between headers files or phases. Unparsed bytes in
an already received chunk count as input, not fictitiously parsed records/work.
No extra next() after a satisfied stop; zero-length ordinary ranges are NOT such
a stop. Record raw syntax excludes terminal LF/CRLF; an EOF lone CR is counted
as raw syntax before decoded removal. Cell raw syntax includes quote bytes and
embedded line endings, excludes separators; decoded cells cannot evade caps.
Count enforces cell/record/column caps without retaining payloads or width checks.

Retained accounting is simultaneous live owned buffer CAPACITY + 2*UTF16 units
for strings + 8/index slot + 32/node/span/ring slot, including unused reserved
slots, headers, ring, output queue, fallback buffer and scratch. Old+new capacity
are charged concurrently during growth/concatenation; only actual release refunds
occupancy. Incoming borrowed chunk is separately bounded by maxChunkBytes and
maxInputBytes; its host allocation is not xan-owned RSS. Native provider buffers
and VFS storage are outside this logical tally, not silently promised bounded.

Work is one per inspected byte (argument/selector/input), compared byte, emitted
index and copied/decoded/encoded/output byte; repeated scans/copies charge again.
Cancellation check at most every 4096 work units and every awaited I/O; cooperative
yield at most every 65536 units. Split a large operation into checkpoints before
it overshoots, not one yield after an unbounded encoding/scan. Counters cannot
overflow safe integers; pre-admit before allocation and output write. stderr,
stdout and files share aggregate maxOutputBytes but never cancellation ownership.
Limit diagnostic/status remains DESIGN section 6: emit the entire exact diagnostic
only if remaining parent/local budget admits it; otherwise no emergency bytes.

## Remaining decisions / independent freeze

Root: approve/revise BYTE-TABLE-V2 per-command CR/malformed/EOF proposals and
same-comma repair; zero-tail source-kind rule; remaining defaults/hard ceilings,
strict numeric/selector/mixed-mode boundaries; bounded writeFile fallback.
Advanced features remain rejected regardless. Diagnostics are exact only for
declared captured rows or specified profile errors, not full xan help/error parity.
Different reviewer must freeze chunk splits, producer reuse, every cap boundary,
UTF-8/display/selectors, aliases/unknowns, abort identity, ownership, early poison
input and partial output behavior. Source inference and this author's probes are
not hidden independent fixtures and must not be promoted to acceptance.
