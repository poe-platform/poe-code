# Independent freeze protocol v1

## Case representation and public observation

`cases-v1.mjs` is declarative fixture data, NOT a shell implementation or runnable
product cohort. `repeat(text,count)` and `concat(parts...)` describe exact finite
host inputs; `null` in an env override means delete that key. Merge overrides into
defaults; Shell itself initializes PWD from cwd. Resolve recipe values before
passing them to existing public APIs. Never add new shell syntax or public keys.

For ordinary cases call `new Shell({fs, commands: new CommandRegistry([observe]),
cwd, env})`, then `shell.exec(source + observeSuffix, execOptions)`. The registered
`observe` captures argv/status, `context.cwd`, and a copy of exported `context.env`
without output or FS calls; return `{exitCode:Number(context.args[0])}`. Its argv
receives `"$?" "$PWD" "$OLDPWD"`, so local/unexported values and export membership
are separately observable. Unlike historical printf snapshots, its final status
preserves the cd status. Register optional `bridge`/`other` only in named rows.
Do not overwrite builtin cd or install default aggregate/network/SafeJS plugins.

S1: Within-one-exec observation is required; a later exec has fresh state and
cannot prove prior cd publication. For rejection rows omit observe, assert exact
public rejection identity and visible request/output events. P1's intermediate
variable/export order and no rollback after rejected exec are SOURCE-REVIEW
invariants bound to public success/partial-failure witnesses, not invented getters,
private-state spies, or claims that context.invoke reads the parent's live cwd.

`calls` arrays are exact top-level FileSystem method-entry order, not wire requests.
`directory` means an actual prepared Memory directory unless an explicitly scripted
stat outcome is needed. `typed` means `new FsError(code,{syscall,path})` constructed
from the SAME public module as the candidate Shell. Preserve the actual thrown
object in the guard trace; shell stderr is human utility text, not errno JSON.
Store entry/resolve/reject times and signal references, and snapshot exact bytes.

The expected selected-state shorthand uses original cwd `/w`; long-cwd fixtures
replace that original cwd explicitly and set PWD to the selected logical candidate.
`cdStatus` on O05 means the registered control command's status, not an executed cd.
Expected stdout is the Shell captured byte concatenation; external delivery may
fail after capture. Do not demand a particular chunk split, except await/order.

Diagnostics compare payload AND baseline framing. Direct argument/missing-variable
returns retain their existing plain `cd: ...\n`; thrown filesystem/private-cap/
readonly/ordinary errors retain `shell: line 1: PAYLOAD\n` for these one-line inputs.
Readonly and ordinary sink messages retain their existing prefix/category. All
no-diagnostic success/EPIPE cases require empty stderr. A custom source name is
not a new ShellExecOptions key. Assertion relaxation for errno or line-prefix
mismatches is not allowed; disclose any candidate disagreement before changing v1.

## G1: guarded actual filesystem and typed faults

Prepare actual MemoryFileSystem directories using its existing mkdir/writeFile/
symlink/chmod APIs before arming the guard. Positive defaults prepare `/w`, `/home`,
`/old`, `/p/t`, `/q/t`, `/w/t` and needed parent paths. Directory modes0755 unless
specified. Never create host fixture directories in this precode phase.

The future public FileSystem wrapper delegates bound methods to the actual backend
(do not spread a private-field class instance). Log every invoked method. After
arming, unexpected methods/paths/modes or calls beyond the exact script throw
`new FsError('EIO',{message:'unexpected fixture I/O'})` AND fail the harness even
if product maps the error. Read/namespace-write/realpath/native/transport work is
forbidden except S07's explicitly enumerated redirection effect. This catches
zero-probe cap admission failures even when status1 would otherwise look correct.

Fault rows inject the explicitly declared typed errors or file outcomes only at
the designated method/ordinal. For repeated-path file/directory races, use a
declared synthetic FileStat with required fields `{type,size:0,mode:33188 or16877,
mtimeMs:0,atimeMs:0,ctimeMs:0}` and NO identityScope/dev/ino/provider-authority
assertions. This is deliberate fault injection, not a faithful provider identity
view or a claim that actual Memory spontaneously changes type. Normal actual
adapter cases do not use fabricated stat/permission outcomes.

Every stat/access must receive a live AbortSignal. For an individual cd all of
these calls share its runtime signal reference. Do not demand equality to the
root caller's signal: the existing runtime composes local scopes. Trigger caller
abort using the supplied controller and check propagation/reason at each edge.
No inference from mode bits in cd; A01's actual Memory adapter enforces denial.

A02 uses actual ReadOnlyFileSystem over Memory; X_OK forwards mode1 without a
write probe. A03 uses actual MountFileSystem with `/m` bound to readonly Memory.
Shell-facing calls are exactly stat/access(`/m/d`); backing access uses `/d`,1.
Mount resolution may use internal lstat/readlink/metadata calls; record them but
do not confuse them with extra cd probes. Never replace mount/readonly classes
with simplistic passthrough stubs or strip capability/identity assertions.

## DAV1: actual accepted adapter, no network

Instantiate public `new WebDavFileSystem({baseUrl:'https://dav.invalid/dav/',
fetch:guardedFetch})` from the exact accepted composition. No ambient credentials,
global fetch, service, listener or host I/O. A04-A06 exercise actual WebDAV methods,
not a mock FileSystem labeled WebDAV. `guardedFetch` accepts exactly the two listed
requests in order and rejects any extra/unlisted request before any transport.

Each URL is `https://dav.invalid/dav/d`; method PROPFIND, Depth `0`, redirect
`manual`, credentials `omit`, non-aborted signal, Cache-Control `no-cache`, and
Content-Type `application/xml; charset=utf-8`. Exact request body:

```
<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getlastmodified/><d:creationdate/><d:getetag/><v:timestamps xmlns:v="urn:virtual-bash:metadata"/></d:prop></d:propfind>
```

207-directory response is a fresh Response with Content-Type application/xml and
the baseline mock's `multistatus(resource('/dav/d',true))` XML, whose resource
payload is resourcetype collection, getcontentlength0, getlastmodified
`Wed, 26 Aug 2026 12:00:00 GMT`, creationdate `2026-08-01T00:00:00Z`, propstat
`HTTP/1.1 200 OK`. The exact helper bodies are bound at baseline
`tests/fs/webdav/mock.ts:33`; future harness may reproduce ONLY these pure XML
builders, recording the inspected-body derivation, not import/transpile a private
resource-registration module or fabricate resource identity. 207-file changes
only collection to empty resourcetype. 403 is a fresh empty Response(status403).
Use instrumented finite bodies and account for reader cancellation/lock release.

The first request is stat; successful X_OK rechecks metadata with a SECOND stat.
A05 denies that second request; A06 changes its type to file and gets existing
ENOTSUP. No listing/GET/PUT/MKCOL/delete request, child authorization, remote ACL,
atomic snapshot, lease or actual-service acceptance follows. Provider-internal
request caps are separate from cd's8194 public VFS-call maximum.

Memory/readonly/mount/DAV qualification is deliberately small, not all adapters
times all cases. Existing Real/S3 observations remain historical; do not claim a
new candidate Real/S3/service pass. Later broad adapter regression requires ROOT
authorization and a separately reported denominator.

## K1/K2: owned cleanup and cancellation

K1 requires await exec and Shell.dispose, complete expected request script, no
unexpected FS/transport calls, pending owned work, held response readers, late
unhandled rejection, unclosed harness signal listener or unreleased gate. Reset
only the case-owned fixture. Do not report global worker zero as local ownership.

K2 uses real public middleware: synchronously call context.registerCleanup with
the idempotent owner-close function BEFORE next()/FS/sink acquisition. The owner
closes new admission, releases or awaits admitted cooperative work, and shares
one completion promise between finally and registered cleanup. Hold one cleanup
gate to demonstrate exec/dispose remain pending; release it and require one
resource release/settlement. Attach rejection observers before resolving/rejecting
deferred providers. No registration-order dependence or arbitrary opaque-promise
preemption claim. Caller cancellation wins even for FsError-shaped reasons.
No sibling filesystem/header/stderr work is cancelled merely to close stdout.

O01's held sink proves await via pending public exec; P1 publication itself is
source-bound and cross-checked by S01/S02/O02/O03, not a fake private-state event.
C04 and L27 retain no-rollback as that same explicit source invariant after root
rejection. A command cannot inspect a disposed/rejected exec's inaccessible state.
C05 aborts from a scheduled setImmediate while a long bounded input scan is still
preflight. The first helper yield is at128 work units; count exact yield placement
by candidate source audit, not by replacing global setImmediate in the user's host.

## Diagnostic fixtures

D01-D04 each use source `cd /d` and a stat-time public FsError('EIO') whose `.message`
is set by the trusted fixture host to the exact supplied payload (no syscall/path
suffix in this special error). Typed EIO is fatal; guard permits only stat(`/d`).
The candidate may not first form an unbounded diagnostic of its own. All four
require status1, unchanged cwd/variables/exports and no stdout/access/fallback.
Compare exact prefix bytes and exact suffix, and physical prefix/newline outside
the private cap. D02's capped payload65,792 produces65,808 physical stderr bytes
under the ordinary15-byte shell prefix plus newline. O05 proves no global/prefix-
matching truncation. Parent-output-budget rejection is separately witnessed by
L27 and the unchanged budget source invariant, not a full-line cap claim.

## Boundary proofs and future execution admission

Boundary fixtures use declared recipes; no 4096-by-adapter-by-layout cross-product.
L18 has cwd2/target1/CDPATH4095 bytes and4097 candidates, each2R+N+2 =14 units:
4098 +4097*14 =61,456 work;8194 public calls. L19 uses cwd48,768 bytes, target1,
CDPATH55 bytes (56 empty slots),57 candidates, R=N48,770:
48,824 +57*146,312 =8,388,608. Final access is admitted and final boundary yields.
L20 changes the first slot to `.` (+1 scanned byte,+4 raw work), while four file
stat outcomes omit four access charges: unconstrained total8,388,609. Final stat
reaches8,388,608; access charge1 is rejected before its call. L21 has cwd40,000,
100 empty slots and69 completed candidates:40,100 +69*120,008 =8,320,652;
remaining67,956 cannot admit the next80,004 raw reservation. No partial charge.

L08-L17 distinguish input, raw join and preflight errors before I/O. Absolute and
dot bypasses never inspect oversized CDPATH. L22-L24 distinguish UTF-8/scalars from
UTF-16; lone-surrogate Memory behavior is not generalized to WebDAV's validation.
L25/L26 keep normal command charges monotonic; L27 retains the real shared output
ShellLimitError, not a made-up cd limit key. Private counters are per invocation.

F01-F07 are NOT RUN future obligations: authenticate a ROOT-routed candidate,
run source public root, genuine package install and physically moved consumer with
source absence/loader guards, types and independently inverted negatives, exact
module/provider identity, plus authorized scoped regressions. Pin case/consumer
membership and tool/source/package hashes before/after, with new-entry detection.
Do not execute them, the28 native scripts, any provider/service/guest/SafeJS runtime,
or a full gate during this freeze. Do not select a prospective implementation by
searching moving HEAD. Future harness adaptations need a new version and disclosure.

## Static checks, sealing and preservation

Only own JS syntax/schema/counts/arithmetic, committed-input hashes, selected
protected membership, and actual accepted-baseline declaration binding run now.
`typecheck-v1.mjs` parses the authenticated baseline tar in memory; it exposes only
actual d.ts/package metadata to TypeScript, not product JS. It authenticates846
package entries without executing them. Ten negative inputs use existing public
properties with invalid values; intended TS2322/TS2375 locations must be exact.
Missing imports, TS2688, or fallback to live src/dist cannot count as passes.
Strict/exactOptionalPropertyTypes and baseline skipLibCheck are explicit; this is
not a full declaration or current implementation audit. No build/emit/install.

The first static type attempt confused encoded-wrapper versus decoded-compressed
evidence hashes; the second exposed an overly restrictive virtual directory guard
that hid @types/node. Both failed before passing type assertions or importing any
product code. `STATIC-ATTEMPTS-v1.md` retains their diagnostics and corrections.

Before/after inventories cover every entry under the listed protected roots,
including empty directories and additions, not just originally tracked paths.
Current root exports/package can differ from5137: preserve their live snapshots,
never import them as the accepted baseline. Initial whole tracked-index enumeration
is reduced to digest/count; initial foreign staged diff was empty. Foreign staged
raw entries, including deletions, are checked separately, not immutable HEAD/index
entries that legitimate concurrent commits can change.

`MANIFEST-v1.json` records exact owned membership and every owned file hash except
itself. Git commit binds that manifest. No other exclusions, including work/tmp or
empty directories. A postcommit read-only validation checks commit membership,
blob hashes and live protected/staging state; no appended artifact self-exemption.
These selected checks cannot prove absence of untracked/unrouted scratch elsewhere.
Seal with explicit owned paths and commit --only; never stage/commit foreign work.
