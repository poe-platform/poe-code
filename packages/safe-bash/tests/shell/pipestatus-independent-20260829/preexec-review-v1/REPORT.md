# PIPESTATUS coordinator PREEXEC review

## Disposition: HOLD final execution proposal

Admission, finite loading controls and known-child lifecycle qualified below;
this is not product/PIPESTATUS acceptance or actual78 authority. Two precise
execution-binding/resource issues need disposition before launch. No production
source changed. Source/PURE acceptance b2b1ed26 is not rescored.

Preexec source `4e151da2701a8f4334bbd1f2a4a15f2e3631b990`; resolved result/launcher
commit `c440c86b6b19b95d393b06ad6df65b994531b37b`. Seal-v2 is795793 bytes,
SHA256 `f61b8fb41db61be3ed89fba296f5cbb9a6e8b4c80dd019202b065fe4f5a093d5`.
Independent preseal3988d171d / SHA256
`a7627ff9bc6db2c14f69973a638049e5d9ab80033de7398730f92346331ac9ec`.

## Blocking execution details

F01: launch-v2.sh correctly terminal-execs Node, but PUBLICATION.json.command
still says `then /bin/zsh .../launch-v2.sh`, not `exec /bin/zsh ...`. If executed
inside the tool shell in that literal form, a lingering outer shell can make
tool-shell + collector + owner + case =4, exceeding the proposed3. No actual
outer launch was run here. Seal the entire eventual tool command with terminal
`exec /bin/zsh .../launch-v2.sh` after finite environment assignments (login:false),
or explicitly change the process proposal; don't infer the outer exec from the
inner script. This is a final-command binding gap, not a measured process overrun.

F02: owner.mjs:54/69/83 checks512MiB via recursive `sample` between cases and at
finalization. Offline npm at owner.mjs:63 runs before the first case sample. There
is no pre-growth working-byte reservation or complete frozen-workflow upper-bound
derivation in this packet. N03 creates11 bytes successfully before `sample(...,10)`
rejects: detection is after growth. Thus512MiB is a sampled admission/detection
threshold, not an enforced instantaneous ceiling or hard quota. Before actual GO,
provide a finite write/working bound including materialization, npm cache, role
files, traces/captures and publication, or seek an explicit qualified sampled
profile decision; don't silently call sampled detection a hard bound. This is a
source/control proof gap, not an observed512MiB runtime breach.

## Recent B2 cache-race question

The recursive sample body does throw ENOENT on a disappeared entry: N01 uses the
exact source-derived function with one deterministic disappearing-child stub and
retains the exact sentinel. HOWEVER this owner does NOT poll it every50ms while
npm runs. No setInterval/census exists in runDirect. The only owner timer is the
deadline abort; samples occur before individual cases after awaited qualified npm
retirement, and finally after knownOutstanding/active checks. Therefore the same
B2 live-cache census race is NOT established here. Samples still aren't atomic
filesystem snapshots or proof against unrelated external writers. Do not repair
F02 by adding the same unsafe live recursive polling during npm mutation.

## Measured controls and deliberate version map

20/20 expected outcomes: C01–C09 body-exact replay, C10 unchanged literal positive,
C11-v2/C12-v2 and N01–N08. To obey ROOT's at-most-TWO harmless-child grant, the two
original separate negative processes were merged into one new caught-import
consumer. It observes exact `EDGE_REFUSED` and `AUTH_HASH`, forbids the bad module
body, and returns both messages. Its exit0/caught boundary is NOT the original
two exit1 fixture replay. Original author12/12/three-child evidence is unchanged.
This qualification is explicit in the committed preseal; no12-verbatim claim.

N01 disappearing-entry/body and no-live-poll call sites; N02 undefined/null/false/0
primary with ordered false/0 secondary failures; N03 post-growth cap; N04 inner
exec/outer missing-exec binding; N05 trace-before-supply/no fsync; N06 compressed
size refusal; N07 body/publication deadline boundary; N08 unknown retirement and
primary-presence rejection. Expected gap characterizations passing do not make
those gaps acceptable.

Actual harmless PIDs55696/55697 both exit0/close/both EOF, qualified closed/hash
captures, no signals, knownOutstanding0. Zero product imports/publicShell/invoke,
Workers/asynchronous loaders/compiler/build/install/npm/native calls. No old PID
group probes or universal process/OS containment claim.

## Admission, tools and routing

Actual unchanged owner preEvaluation authenticated307 selected inputs and1010
manual-artifact members. Source projection
`74fec4d4e26d9c0b2d27613c15af7a88cb56f628`, compressed1005288-byte archive SHA256
`6c60e2d766fa675b7972afdc0eb6f5304f99231abceff1daf5cb196b897346a5`.
Type/exact size/hash admission occurs before gunzip; same admitted Buffer decoded
with32MiB output ceiling. Strict tar regular-member checksum/mode/content/set
checks then materialization/readback; no extracted module evaluation. This is a
manual build artifact, NOT a freshly npm-produced or installed package.

npm10.9.7 closure2039 file/link entries,12 exact target-hashed links and517
directory records was checked pre/post with actual verifyNpm. Node executable is
stream-hashed using64KiB reads. No npm process or observed npm module-load trace.
All17 sealed helper/data identities checked before controls and after retirement.
307 source inputs are checked by actual preEvaluation; no B35/newL02/Node overlay.
Private transport remains46611. Materialized control root is separate from the
unused future actual root and retained; no old roots or staging were cleaned.

makeRole binds concrete full regular-file app contents and static edges. Product
root exceptions are explicit; source-built imports absolute dist/index.js, installed
and physically moved routes resolve virtual-bash from their actual app. Future
installation uses scripts-disabled offline npm, distinct empty user/global configs,
and a separately verified tool closure. Future move renames the whole installed
app, requires old origin absence, rebuilds absolute bindings and verifies product
bytes before/after each case. Installation/move/nested public module loads remain
UNRUN here. Static regex-based edge extraction is a finite trusted-code profile,
not a general JavaScript reachability analyzer or OS network fence.

Permission args deny child/worker/addon/wasi/inspector; synchronous registerHooks
uses main thread. Guard byte admission precedes returned source. Its event named
`module-loaded` is emitted BEFORE returning source: prepared supply, not evaluation.
The harmless literal output independently proves only its fixture evaluation.
Trace uses inherited appendFileSync, cap before append, and parent hashes complete
trace after retirement. No loader fsync/crash durability. This is not a rerun of
B2r7's custom short-write/close-fault helper or a new loader fault-injection claim.

ObservedShell forwards the exact original dispose Promise and records completion
via handlers; this is explicit TEST-only instrumentation. H01 private postreject
state and H07 internal pre-errexit vector remain SOURCE-only.81 public exec and
three invoke calls/78 cells are future identities, not executed outcomes.

## Authority, history and accounting

No grant/window or product activation. Future proposal93 known starts including
84 conservative execution images and9 admin, peak3 CONDITIONAL on outer exec;
1800 seconds total with180 publication, case30s/install120s,96MiB aggregate capture,
512MiB sampled working threshold qualified as F02. No guarantee78 cells complete
within the global window; stop/unrun accounting must remain truthful.

Original G18/23of24/build, corrected24, independent36PURE,56 preparation roles,
v1 launch topology and v2 launcher SOURCE-only history retained. This review's
first source-view helper exited1 on a200000-byte bound for the795793-byte seal;
raws retained. Later exact size/hash admission is versioned; no lost-byte claim.
Two PURE helpers (prepare/control), two harmless children; publication/admin are
separately counted in PUBLICATION.json. Direct-to-file raw capture precedes every
fallible helper. No unknown owned retirement, capture loss or integrity failure
observed. Git internal storage/RSS/native threads are not measured by logical
snapshots. Frozen author files unchanged; final own state checked scoped only.
