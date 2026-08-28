# Final policy v3 — independent freeze pending

Current root disposition supersedes conflicting proposals in DESIGN/PROFILE-V2/
BYTE-TABLE-V2/HANDOFF-V2 at accepted candidate
`b9ce9e61115c7d99dfa6a76591b3dcfdaee9ce21`. V2 files and original RECEIPT,
LOCAL-BINDING, REVIEW-BINDING remain historical, byte-preserved records.
Use current DESIGN with this delta and BYTE-TABLE-V3; inherit only nonconflicting
v2 I/O, accounting, CLI and dialect details. No implementation is authorized by
this document. Root routes Dirac; no independent review has run here.

## Approved dialect and faithful output

Root approves the declared per-command CR/BOM/count-versus-parser dialects,
Select/Slice M refusals for stray unquoted quotes and after-close junk, and
unterminated-final-quoted-field repair to valid serialized CSV at EOF. M means
status 1 and exact `xan <subcommand>: unsupported malformed CSV quoting\n`;
already-emitted header remains, no rollback. Headers retains its permissive
header-only decoder; Count retains quote-state splitting, not width validation.
Source-inferred/unmeasured rows remain PROJECT PROFILE, not native proof.

For input `"\ra,b\r\nx\ry,z\r\nu,v\r"`, Select logical header is
`["a","b"]`, body `[["x\ry","z"],["u","v\r"]]`. Both CRs are data.
Output MUST be `"a,b\n\"x\ry\",z\nu,\"v\r\"\n"`, status 0, empty stderr.
Slice's separately declared decoder keeps header `["a","b"]` and body
`[["x\ry","z"],["u","v"]]`; output `"a,b\n\"x\ry\",z\nu,v\n"`,
status 0, empty stderr. Do not silently remove Select's EOF CR or change Slice.
This reconciles Select's declared logical raw-CR retention with writer grammar;
it is an approved serialization deviation, not a new native observation.

Same-comma raw preservation requires BOTH valid writer grammar and exact
reversibility of logical values/field counts, plus the existing owned-span and
budget rules. Every CR-containing logical cell is quoted even if byte-copying
would match native output. Cross-delimiter output decodes doubled quotes once
and reserializes. Initial marker EFBBBF is stripped only at source byte zero,
chunk-invariantly; noninitial BOM is data. If that data becomes the first output
cell at absolute byte zero, quote it, including reordered headers. Partial BOM
prefixes at EOF remain data. Single-empty/zero-cell distinctions are unchanged.

## Uniform zero-tail; ordinary zero ranges unchanged

`-L0` emits NO DATA ROWS uniformly for stdin and every VFS file. Header mode
reads only the first logical record and emits its header. Empty/BOM-only input
retains the existing synthetic zero-column header LF. With `-n`, output is
empty and no input iterator/read is acquired. For `"a\n0\n1\n2\n"`, stdin and
VFS output are both `"a\n"`, or `""` with `-n`; status 0, empty stderr subject
to ordinary preflight/output success. Native additional 04 stdin emitted
`"a\n2\n"`; additional 05 regular file emitted `"a\n"`. Keep both observations.
This is a deliberate stdin compatibility gap, never an operand/seekability rule.

Only the stopping condition changes: keep factory/argv/path/limit validation,
existing -o identity preflight and output rules, even for a zero-byte result.
No new permission or lifecycle shortcut. With headers, do not parse body records,
diagnose unused body bytes, allocate a tail ring or request an extra next().
Charge whole delivered chunks including read-ahead; unparsed body is not counted
as parsed records/work. Borrowed stdin is not returned/cancelled; owned VFS
cleanup follows the existing admission/idempotent-close rules. A requested -o
still publishes under existing wx/w/refusal rules, even with -n and empty output.
Positive -L N retains the bounded forward ring. Ordinary -l0, -s1 -l0,
-s1 -e1, -e0 and source-inferred related rows retain the v2 post-write stop rule;
zero/equal ordinary ranges are NOT no-input or safe-empty optimizations.

## Approved bounded fallback and exact limits

Keep v2's existing comparison/preflight and writeStream composition. When
writeStream is absent, root approves bounded whole-result writeFile with the
SAME flag: actual conditional wx for observed missing, w for observed distinct
existing. Pre-admit all simultaneously live payload/staging/old+new buffers
under retained, output and parent budgets before publication; refuse if they
cannot fit. No empty-create+append, new fallback-size limit, capability contract,
permission fallback or streamingWrite gate. Unsupported actual operation refuses.
Unknown aliases, borrowed stdin with existing destination and unavailable truthful
authority retain their existing refusals. No atomic identity-conditioned open,
lease, rollback, provider acceptance or all-size streaming guarantee is claimed.
Existing omission of explicit mode remains; no chmod or permission workaround.

All 18 DESIGN limit defaults and all 18 hard ceilings are approved unchanged,
including auxiliary limits. V2's prose “19” was a count error; no row/value changed.
Parent budgets always win; no quota bypass/RSS/provider allocation guarantee.
All v2 simultaneous-capacity, output reservation, phase aggregation, cancellation
and diagnostic-budget rules remain in force. FINAL-BINDING-V3 records exact rows.

## Remaining scope and blockers

Strict numeric/selector/mixed-mode boundaries remain declared proposals requiring
explicit resolution; this delta adds no grammar or feature breadth. Source-only
and unmeasured outputs, chunk schedules, producer reuse, every limit boundary,
UTF-8/selectors, ownership/abort precedence, aliases and partial output require
Dirac's independent fixture freeze. No hidden fixture was read; no new probe,
download/native execution, product test/build/typegate or reviewer run occurred.
There is no shared API blocker for the approved nontransactional profile; actual
provider capability/truthful authority remain prerequisites, not new guarantees.
Root must route Dirac before implementation; no acceptance/full-parity claim.
