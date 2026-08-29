# ERE12 resolved-slot independent DATA review — ACCEPT

Activation commit `016aa3a940c19dc17fd94bce0ed7468676e1d5c5` is accepted **only for
the exact resolved slot and conditional authority bindings reviewed here**. This
is not tool approval or actual native acceptance. All12 observations remain UNRUN.

## Exact immutable bindings

| Object | SHA256 |
| --- | --- |
| ROOT runtime receipt | `644630c96f3cdc647aabd9f21cf6c660d2c982fd75b0d8b33c61b241168e2476` |
| GO | `9eec9e95250998fc3bf78ee8727bbfbbba6d32c7aab42155291a5cea34a753ec` |
| Resolved JSON | `d2dca84a74ff36a2a7fae05986f237acd5cf3d8c35caa3e4d97ee96344d6460d` |
| Exact UTF-8 command, no newline | `9423c7e1d4bbbc6c77bef3962bfe97b93fe333f65263cb2f4df12f555a239e25` |
| Executable preseal | `211483cbe1b12ad505345da5396a227c7da9931743d035ed365f7cc74bb4d457` |
| Requests | `2678d8619553f9d8d9669f078c29847c65c31984ebd0ab6bdeeea271a213acc8` |
| This review's RESULT.json | `fa39a351048feb14738670cc4b911a6da9e9f46e2ce65b4225f7650ea332411b` |

The seven-key runtime receipt binds the exact independent commit
`f5d9e55ec3f3643904f1ec51d1cfa110b6a6dea8`, accepted source
`2d07f5921010fda988dcda36ac81a89831fbac55` through its unchanged preseal and
committed independent result, and exact requests. The original non-runtime result
remains `notRuntimeReceipt:true/nativeAuthority:false`; it was not relabeled.
The separate ROOT runtime receipt is correctly distinguished and pinned by GO.

All schemas/key order, hashes, lengths and pin fields match. The actual live
receipt, GO, provision, preseal and resolved JSON are canonical regular single-link
files with0600 modes; Git's index mode is not used to infer0600. All25 presealed
source/data members—including nine modules and twelve programs—match immutable
accepted blobs and declared modes. No payload module is imported. Explicit parent
device/inode/mode0700/canonical-path checks match the provision receipt. The root
contains only the closed empty0600 journal and empty outer/cases/captures directories;
both bootstrap captures remain absent for future noclobber creation.

Only `ROOT_APPROVED_GRANT_SHA256` is substituted, exactly once. All remaining
parameter keys/values and order are unchanged against the accepted template,
including workdir, shell, justification, redirections, `require_escalated`,
`login:false` and absence of `prefix_rule`. Receipt→GO→command is acyclic;
this later review does not modify any earlier authority object or command hash.

## Fixed window — no renewal

- Issued **August29,2026 10:01:09.884 UTC**.
- Expiry **August29,2026 10:46:09.884 UTC**.
- Latest actual start preserving the full600s: **10:36:09.884 UTC**.
- Checked **10:09:40.311 UTC**: 1,589,573ms remained until latest full-window start;
  2,189,573ms until expiry.

This is a freshness observation, not a reservation or permission to start later.
Sagan/ROOT must freshly recheck full-window availability, namespace/source/tool
preflight and exact tool approval immediately before actual activation. Expiry is
not extended and this review grants no retry or automatic renewal. Current binary
hashes were not remeasured here; the authenticated author's10:01:09 tool-hash
observations remain separate from the required fresh future actual preflight.

## Unchanged scope and qualification

The exact12 N01–N12 literal programs have no native expected goldens, zero fixtures,
empty stdin, fixed loops/builtins and the exact six-key child environment. Child
HOME/TMPDIR/cwd and empty PATH are task-owned; no BASH_ENV/ENV/exported functions or
external-command expansion is introduced. The600s inclusive total,3s cases,
TERM2/KILL1,40 all-known starts/peak3,13 managed starts/peak2,64KiB stream,
32MiB capture and128MiB working bounds remain byte-identical to accepted protocol.
Initial tool-shell startup is explicitly trusted host behavior outside child
clean-env/raw-capture qualification. Fork reservations are not an OS census/quota.

Raw NUL-framed status/cardinality/value bytes are observations, not passes.
No hidden span or nonparticipation inference, GNU5.3 claim, containment, parity or
old37 authority reuse. R01 remains unresolved. Old v1 FD failure, prior review's
metadata/I04 fixture failures, activation's captured EOF-helper defect and old
forced-termination HOLDs remain unchanged; nothing here rescores them.

## Execution/accounting of this review

SOURCE/DATA only: zero Bash/native/entry/payload/product/build/Worker/engine/private/
network execution and zero approval requests. Three bounded Git DATA children
completed normally under qualified preopened raw capture; the DATA checker spawned
none. Snapshot facts and exact schemas were checked without importing target code.
No compressed artifact required decoding. Literal immutable source blobs and
activation documents are retained as DATA with Git-blob/SHA256 bindings.

Known explicit roles including publication: collect patch+Node+2Git=4;
authority patch+Node+Git=3; checker patch+Node=2; report patch=1;
final shell/add/commit/status (exec replaces shell)=3: **13 known starts**, peak2,
within24/peak2. Existing persistent inspection kernel/tool/platform transitives are
not claimed as an observed universal process census. Metadata captures have fixed
2–4MiB file ceilings and actual small outputs; no native binary was read or copied.
Instructions were read separately and never stored. No helper/assertion correction,
safety, capture, integrity, unknown-retirement, deadline or cap failure occurred.

**Next required authority is ROOT's direction plus fresh preflight and the exact
explicit tool approval—not execution by this reviewer.**
