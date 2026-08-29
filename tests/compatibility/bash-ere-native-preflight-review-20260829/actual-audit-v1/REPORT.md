# Native12 ERE artifact audit — qualified observation-oracle ACCEPT

The authenticated artifacts support **twelve finite local Bash3.2.57 observations,
not twelve passes**, whole-Bash parity, hidden native spans, GNU5.3 behavior or an
OS-containment result. No native program, ERE engine, product or target module ran
in this independent DATA audit. The one actual attempt is consumed; no retry.

## Identities and raw preservation

| Object | Binding |
| --- | --- |
| Actual source/evidence commit | `6b4ca17046a6f86b1947df28cd5bbdb876c9031f` |
| Observation manifest SHA256 | `d77e2767f6b36a9ec710224ef31faa53ec388304b5616a4818e18657bf1cb274` |
| Final seal SHA256 | `1bb8ab78a65d8e85b7624b2dafb00fdc74ce19a7ed70a4cbe16ad72c96a604fc` |
| Independent audit bindings SHA256 | `3ed12d50ee8b427334b903e89e065759eccb132335d46cbf0da51f1901f0b8bd` |
| This audit RESULT.json SHA256 | `7eb4ffbf09bcf024ebb2b86939d058adc6c8816b693c5087a055b87735350c90` |
| Accepted executable preseal SHA256 | `211483cbe1b12ad505345da5396a227c7da9931743d035ed365f7cc74bb4d457` |
| GO SHA256 | `9eec9e95250998fc3bf78ee8727bbfbbba6d32c7aab42155291a5cea34a753ec` |
| Exact command SHA256, no newline | `9423c7e1d4bbbc6c77bef3962bfe97b93fe333f65263cb2f4df12f555a239e25` |
| Pinned `/bin/bash` SHA256 | `35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3` |

Git type/size admission and blob authentication precede DATA parsing. The complete
actual publication inventory is bound, not a sparse selection. Every final-seal
member matches bytes/hash. The deliberate recursive-seal exclusions are exactly
`FINAL-SEAL.json`, `raw/seal.stdout`, `raw/seal.stderr`; those are bound by the actual
Git commit, and seal stdout independently repeats the final-seal/observation hashes.
No excluded file is silently treated as a recursively sealed member.

All40 runtime files total **52,128bytes**, with75 directory records. Every captured
file also matches the retained task-owned original runtime namespace byte-for-byte,
including exact membership and modes; no file was repaired or deleted. All24 case
streams are authenticated: **483 stdout bytes total, zero stderr bytes**. The two
outer captures are also empty and authenticated. Git cannot retain empty directories;
their source-bound inventory is additionally corroborated by the current live
task-owned namespace. This readback does not claim hostile-host race resistance.

## Exact shell-visible observations

| Native ID | Status | Cardinality | Present values, in index order |
| --- | ---: | ---: | --- |
| N01 | 0 | 3 | `["aba","a",""]` |
| N02 | 0 | 4 | `["ab","b","","b"]` |
| N03 | 0 | 4 | `["abcac","ac","a",""]` |
| N04 | 0 | 3 | `["bananas bas ","bas ",""]` |
| N05 | 0 | 3 | `["aba","a",""]` |
| N06 | 0 | 3 | `["abb","b",""]` |
| N07 | 0 | 4 | `["ba","a","a",""]` |
| N08 | 0 | 3 | `["ab","ab","b"]` |
| N09 | 0 | 2 | `["b",""]` |
| N10 | 0 | 2 | `["b",""]` |
| N11 | 1 | 0 | `[]` |
| N12 | 2 | 0 | `[]` |

Independent byte parsing consumes **exactly16 NUL-terminated fields and all bytes**
per stream: marker/id/status/cardinality plus four index/presence/raw-value triples.
No extra field, trailing non-NUL byte, absent-slot nonempty value, duplicate index,
cardinality mismatch or discarded empty field is accepted. Empty slots remain
present where their presence byte is1. `AUDIT-BINDINGS.json` retains each slot's
base64 and byte count; the value table is only an ASCII rendering of those bytes.
N11 and N12's zero cardinality and their statuses1/2 are preserved, not failures of
capture qualification and not success statuses.

N09 `(a)?b`/`b` and N10 `(a*)b`/`b` produce the same visible empty value. The captured
interface cannot distinguish hidden nonparticipation from a zero-length native
span. No numeric span/null tuple is inferred. N11's nonmatch and N12's invalid ERE
are each the first regex operation in a fresh process; neither seeds a prior
nonempty BASH_REMATCH. Therefore **N11 does not prove clearing prior captures and
N12 does not prove invalid-pattern preservation**. Those state-transition questions
remain untested by this cohort.

## Lifecycle, authority and time

The exact accepted programs, zero fixtures, empty stdin and six-key child environment
match source2d07 and the enrolled journal argv bytes. Nine modules/twelve program
files/four JSON inputs remain byte-identical to their accepted source and retained
live copies. The authority chain matches reviewf5d9, activation016a and slota1d03.
PREFLIGHT and FINAL-SEAL record matching hashes for Node, Bash, env and zsh before/
after actual execution. This audit compares those authenticated records; it does
not claim a fresh version probe, independent kernel executable mapping or dynamic
loader graph verification.

Each native child has spawn/exit/close, `signal:null`, `stop:null`, no errors/signals,
stdin completion, successful flush/size/hash/close, and owned-group ESRCH absence.
Distinct PIDs and ordered journal enrollment/terminal/credit events account for12
children; timestamps are sequential and each recorded case duration is below3s.
Before/after work/HOME/TMP/PATH snapshots match exactly. No TERM/KILL path was taken,
so no forced-termination qualification is added.

Saved case JSON correctly retains **`receiptPublished:false`**: accepted source
writes that JSON before setting the in-memory flag and recording credit. The37
journal entries (one owner start plus12 enrollment/terminal/credit triples) and
owner `completed:12/halted:false` corroborate subsequent credit. No stored false
field was rewritten to true. `streamEOF:null` is regular-file capture, not an EOF
observation. Owner ledger active1 is its pre-exit state, not evidence of a leak.

The owner exit0 and exact escalated request are supported by the user's explicit
actual-run attestation and **agent-recorded** TOOL-RETURN metadata referencing
request chunk67c13d/session71922/terminal chunk7ee52d. The artifact states
`toolSignalField:NOT_EXPOSED`. This reviewer did not observe the original tool-control
plane; artifacts alone do not prove unobserved approval state, signal fields or
whole-process census. No default-mode fallback is present in the recorded parameters.
Initial tool-shell startup remains the declared trusted-host boundary.

| Clock/event | UTC on August29,2026 |
| --- | --- |
| Actual preflight start | 10:16:29.774 |
| Owner start | 10:16:44.325 |
| Initial readback published | 10:17:19.402 |
| Final seal | 10:20:31.333 |
| Actual Git commit timestamp | 10:20:31, second-resolution |
| Earlier whole-actual deadline | 10:26:29.774 |
| Owner's runtime deadline | 10:26:44.325 |
| Fixed ROOT GO expiry | 10:46:09.884 |

The **two recorded deadlines differ by14,551ms**: the owner uses its own start+600s,
while preflight/readback/sealing apply the earlier preflight-start+600s budget. All
observed work and publication fit the earlier boundary; no actual overrun is shown.
This natural-run evidence does not establish forced retirement at the earlier
outer deadline under a stalled owner. The second-resolution Git timestamp is not
a millisecond chronology measurement. No expiry renewal/reset or extra attempt is
permitted merely because the GO timestamp remains in the future.

Managed starts13/peak2 are directly corroborated by the owner ledger. Author's
35 known direct starts and36 conservative executable roles include administrative
accounting and preserve the earlier32-role estimate delta; peak3 and67,017 combined
observed capture bytes are reported. These are not a universal OS census, kernel
quota or independently observed exit record for every tool-internal process.

## R01: what changes, and what does not

Immutable authority basis `08e40d411dc47bd725cb138e7d419ef2079a2879` distinguishes
the GNU libc manual's documented last-parent-match reporting model from an
unestablished normative POSIX quotation and previously unrun native evidence.
This audit did not retrieve new documentation or execute a model. It authenticated
the original model fixtures and captured source/installed/moved results from that
basis. Only **value vectors** are compared to native output, not native spans.

| Original identity | Native witness | Old frozen engine values | Native/model visible projection |
| --- | --- | --- | --- |
| I01 optional reset | N01 | `["aba","a","b"]` | `["aba","a",""]` |
| I02 alternative reset | N02 | `["ab","b","a","b"]` | `["ab","b","","b"]` |
| I03 nested reset | N03 | `["abcac","ac","a","b"]` | `["abcac","ac","a",""]` |
| I04 manual example | N04 | `["bananas bas ","bas ","na"]` | `["bananas bas ","bas ",""]` |
| I05 finite repetition | N05 | `["aba","a","b"]` | `["aba","a",""]` |
| I06 zero-iteration child | N06 | `["abb","b","a"]` | `["abb","b",""]` |

Thus the old frozen f97 engine's retained inner strings disagree with these six
finite local Bash observations. The GNU-documented model's empty-string projection
agrees; its internal null spans are **not** independently proved by these outputs.
N01 also contradicts authorE12's original visible `b` expectation. Keep that original
fixture/result and any future versioned change distinct; author66/66 is not rescored.

N07 (`((a)|(b))+`/`ba`) is the designated I23 witness and supports `['ba','a','a','']`.
N02's `ab` happens to overlap that same property domain, but the cohort is not the
62-input enumeration. The old I23 group/52 contradictions remain unresolved as a
whole: do not credit all62 or all52 from one designated witness. Other patterns,
lengths, libc/Bash versions, ranking histories and cancellation behavior were not
tested here. R02's separate checkpoint concern is not addressed by this audit.

### Precise recommendation to ROOT/Plato

1. Accept these12 raw observations as the finite local Bash3.2.57 oracle. If ROOT
   adopts that observed profile, ratify **shell-visible last-parent reset reporting**
   for the six literal conflicts plus the designated I23 witness, rather than
   retaining the old stale inner strings merely to preserve E12.
2. Separately decide the internal absent/null representation and general reset
   semantics using the documented model/project contract; do not call native hidden
   spans established. Keep history ranking and final reported captures distinct.
3. Authorize a versioned E12/reference fixture amendment and source correction only
   through the appropriate owner. Preserve the original seven R01 FAIL groups,
  17PASS/7FAIL per layout, author66/66 and I23's62/52 history until new candidate
   verification. This DATA comparison is not a new product test run or rescore.
4. Keep N11 clear-prior/N12 invalid-preservation, wider I23 coverage, other native
   versions and forced-termination behavior explicitly open; they need separately
   authorized evidence if required. No additional native query is authorized here.

## Audit execution and preserved inspection error

This review used only bounded metadata and DATA helpers. Eight Git metadata children
completed normally with direct-to-file captures and known retirement; no native,
engine, product, compiler or Worker child was admitted. Known direct roles including
publication total20: collection5, full fetch4, normative fetch4, audit3, report1,
final add/commit/exec-status3. Known peak2 is within3. These are explicit roles, not
all tool/platform transitives or RSS measurements. All data fits the fixed per-file/
aggregate admission bounds; no compressed artifact required inflation.

One read-only inspection call guessed `actual-v1/readback.mjs` and returned
`Cannot read properties of undefined (reading 'body')`; the immutable inventory
showed the correct filename `publish.mjs`. No target/process was admitted, no raw
observation was lost or changed, and no output from that failed inspection is
credited. All underlying immutable inputs were already durably captured. The
subsequent inventory-based lookup is a metadata/helper correction only, not an
oracle repair. Original author/helper/fixture failures remain untouched.
