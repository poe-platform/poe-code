# Mapfile/readarray implementation and qualification

`index.ts` now exports `mapfileExtension()`, providing both builtins with runtime
identity tagging. Actual Shell record/callback tests execute through the borrowed
record and incremental binding APIs. Open-descriptor validation and byte-valued
diagnostics are now integrated. The primary target is GNU Bash 5.3.0, not 5.2.37.
The current 241-test cohort passes against frozen authenticated 5.3 observations
and the hash-recorded core snapshot described in the final section. This is not
full compatibility, live-oracle execution on each unit run, or release acceptance.
Parser and direct-lifecycle tests are not substitute product compatibility passes.
No fallback process, default registration, private storage access, or atomic
replacement approximation has been added.

## Primary reference binding

The seven native-consuming mapfile fixtures now use `primary-reference.ts` and
the SHA256-bound `primary-reference.json`, containing 170 authenticated GNU Bash
5.3.0 observations for 147 distinct requests. Each observation is bound to its
fixture hash, exact program and argv, absent explicit argv0, and stdin bytes
(including the distinction between omitted and empty input). Fixture and reference
hash mismatch, an unknown fixture, or an uncaptured request fails closed. The
expected status/stdout/stderr come only from the native observations, never from
virtual output. The reference loader does not invoke native processes, read an
ambient oracle path, add environment flags, or skip cases. Test names referring
to native behavior describe the originating observations, not a new host run.

The primary executable SHA256 is
`a0cfc1af0ff50f6b6e67c638979e2604f1c276c90116937fbaafcabb62ee2b40`.
The observations used `LC_ALL=C` and
`PATH=/__safe_bash_oracle_no_path__`, with the existing bounded authenticated
helper's invocation settings. Only a temporary copy's version qualification was
adapted for capture. The shared `trap/oracle.ts` remains unchanged. Its 5.2
prerequisite policy is not silently changed for other extensions.

## Original 5.2 native binding (historical)

The original tests reused `tests/shell/extensions/trap/oracle.ts`. Both explicit
`SAFE_BASH_TEST_BASH` and `SAFE_BASH_TEST_BASH_SHA256` are required for live tests.
Both absent skips only native cases; partial, malformed, inaccessible, wrong-hash,
or wrong-version prerequisites fail. The reference is Bash 5.2.37 with C locale,
authenticated by SHA256
`f5b331844c67482075aea7883153127668cc67f83a60a7b4362cc8469a9dc77d`.
The authenticated helper bounds executable hashing, process time, and output.
There is no implicit executable path and no replacement oracle.

The bounded regular `builtins/mapfile.def` in the root-provided Bash 5.2.37 source
was inspected. Its `mapfile`, `run_callback`, and `mapfile_builtin` functions agree
with the live observations. Attempts to retrieve the official GNU manual and
tagged upstream source through the web tool returned no usable content; the
local source and authenticated executable are the actual evidence for this leaf.

## Confirmed native behavior

- All eight option letters have live coverage: `-d/-n/-O/-s/-t/-u/-C/-c`, with
  `-t` also exercised in attached groups. Complete permutation/diagnostic coverage
  is pending.
- Default MAPFILE, readarray alias, empty input, unterminated final records,
  delimiter retention/trimming, first-byte delimiter selection, NUL delimiters,
  attached arguments, explicit origin preserving untouched cells, and unread tail
  are measured. Extra operands after the array name are ignored.
- Counts/origin/quantum use decimal conversion and unsigned-32-bit admission;
  surrounding numeric whitespace is accepted, hexadecimal text rejected.
  The array index wraps from 4294967295 to zero without a dense allocation.
- Before the first callback, implicit-origin clearing is already visible. Each
  subsequent callback sees prior assignments. Callbacks run before the current
  assignment and their ordinary nonzero status does not stop mapfile.
- A callback making the admitted target readonly does not prevent remaining
  native writes. Callback array replacement changes the visible subsequent
  assignment target. Exported scalar promotion is accepted by native mapfile.
- For ordinary newline-delimited input `a<NUL>b<LF>c<LF>`, native values are `a`
  and `c<LF>`. The first record is consumed through LF but its assigned string is
  truncated at NUL; this differs from Bash read's removal of unquoted NUL bytes.

One exploratory `mapfile -u 1` using the child-process stdout pipe hit the existing
two-second native helper timeout. No expectation was inferred from that incomplete
probe, no timeout was increased, and that descriptor configuration is not included
as a passing case. Descriptor behavior needs explicitly controlled direction and
lifetime, rather than assuming the host pipe descriptor is read-ineligible.
A separate bounded manual probe used the already-existing `/dev/null` device as
an explicitly write-only native FD, without creating a host fixture file:
`a=(old); mapfile -u3 a 3>/dev/null; printf 'status=%s,count=%s' "$?" "${#a[@]}"`.
The authenticated result was status 0, stdout `status=0,count=0`, empty stderr.
The canonical regression uses only the memory VFS `/output`, not a host path.

## Original generic API evidence

`prerequisites.test.ts` uses the actual Shell extension context and memory VFS:

1. `bindings.prepare()` stages invisibly and `commit()` permanently closes its
   publication. It cannot publish each record while remaining admitted across
   callbacks. A single final commit would hide required prior-line effects.
2. Reopening preparation per record calls `IndexedBinding.copy()` on the whole
   existing array. The bounded 32-record probe measures 496 preceding cells copied
   (32 * 31 / 2), not linear publication. That workaround is not implemented.
3. Current transaction set/commit recheck readonly after callback evaluation;
   native mapfile's already-admitted target remains writable in that case.
4. Current indexed preparation rejects exported scalar promotion outright.
5. `input.borrow().read(true)` turns `a<NUL>b` into `ab`, irreversibly losing the
   position needed for native mapfile truncation. The memory-VFS script also checks
   a shared descriptor alias consumes the following record correctly.

The initial qualification has 34 pinned-native cases and five current-API
characterization cases. These tests precede production implementation. Fixture
authoring exposed an unsupported existing read `-u` option and a Buffer versus
Uint8Array assertion mismatch; the fixture now uses supported `<&4` redirection
and compares bytes, not container classes. Neither is claimed as a repaired
mapfile product defect.

## Required primitive contracts

Root reports internal raw records committed as `1e9ee0d17`. The separately owned
incremental writer is frozen pending independent review. Its public API is
`bindings.openIndexed(name, { clear? })` with `set(index, ShellValue)`/`close`.
The leaf calls that API, never the one-shot transaction or private array storage.

The earlier 110-test phase reproduced three generic integration gaps:

1. Public `input.borrow().record({delimiter?})` was absent. Sixteen execution tests
   failed on the missing method; the internal raw-record primitive was not a public
   borrowed-cursor substitute. Required records retain delimiter/NUL bytes and
   expose `shellValue`, delimiter/EOF reason, and owned release.
2. `context.diagnostic(string)` cannot preserve byte-valued argument errors with
   the runtime-owned script/line prefix. The real Shell currently emits
   `[object Object]` for the raw invalid-identifier fixture, instead of native
   bytes. The leaf retains bytes rather than applying lossy string conversion.
3. Open-FD validation and input readability are conflated by `borrow()`. An open
   write-only descriptor is accepted by native `-u`; native clears the array,
   encounters a read error and returns success. Current borrowing rejects it
   before clearing, exactly like a missing FD. This requires distinct validation
   or an admitted open-FD borrow whose read reports EBADF. Treating every failed
   borrow as EOF would incorrectly accept genuinely missing descriptors.

A separately owned incremental indexed-publication capability is required. It
must admit and optionally clear/promote the target before input consumption,
publish each assigned cell immediately without copying all old cells each time,
retain byte identity and shared array quotas, preserve local/snapshot observers,
and drain admitted writes on close/cancellation. Readonly admission versus later
callback attribute changes and exported promotion must be explicitly supported,
not bypassed through private storage. Callback unset/type replacement needs safe
identity validation; the C source itself warns of unsafe stale-target behavior,
which must not become a product use-after-free or arbitrary authority escape.

A separately owned binary-record borrow operation is also required, returning
owned raw record bytes (including embedded NUL boundaries), delimiter/EOF outcome,
and explicit release. It must use the existing shared descriptor cursor, account
bytes before allocation, yield on empty producers, and enroll/drain cooperative
reads. Existing read builtin semantics must not be silently changed. With raw
records the leaf can implement native string truncation and delimiter retention
without reconstructing bytes from display strings.

Public raw borrowing has since landed in the worktree under independent review.
The leaf uses it directly and does not change or bypass frozen core. Missing byte
diagnostics and descriptor capability distinctions remain; further current core
findings are recorded below. No claim of complete mapfile/readarray parity is made.

## Option parser boundary

The parser implements all eight option letters, grouped/attached arguments,
repeated options, `--`, exact `--help` recognition, first-operand termination,
ignored trailing operands, default MAPFILE and explicit-origin clearing semantics.
It preserves raw callback/delimiter bytes and byte-valued invalid-argument details.
The caller supplies descriptor validation; each `-u` validates immediately so an
invalid descriptor takes precedence over a later bad option, and falsey failures
are not wrapped. Acquisition/cleanup remains the eventual invocation owner's duty.

The parser tests first failed because the source module did not exist. The first
implementation passed 30/32; two ASCII diagnostic representations were then
corrected without dropping raw-byte diagnostics, yielding 32/32. An additional
live test confirms all 18 refusal expectations and the native `--help` status of
2 (its help is stdout, not an ordinary success exit). These parser tests alone do
not establish streaming/callback/array publication behavior for a product builtin.

## Execution and lifecycle boundary

`behavior.test.ts` first failed because the factory export was absent. The factory
now parses all options, admits/clears the indexed writer before reading, consumes
raw records incrementally, truncates shell values at embedded NULs, optionally
trims delimiters, and invokes byte-quoted callbacks before each selected assignment.
Indices and callback counters use native uint32 wrapping. Ordinary callback status
is ignored; cancellation and escaping failures are not. Shared array/input/eval
budgets remain the generic owners' responsibility, not private replacement stores.
Callback quoting is linear with cooperative checkpoints and bounded by the admitted
record size; source evaluation still has its existing cumulative source limit.

Cleanup is registered before acquisition. An initialized operation holder avoids
TDZ access by early cleanup. Close stops admission, releases existing borrows before
joining pending work, then drains late-acquired records/writers as well. Sixteen
direct-execution tests pass for binary values, exact finite consumption, callback
quoting/order, default quantum, late writer admission, pending records and writes,
and falsey primary/cancellation precedence. They passed when added; no invented
lifecycle red phase is claimed. Guarded lint 15 found prefer-const on the work
binding; the narrow holder correction retained all 16 passes. No later full lint
pass is claimed by this leaf.

Both mapfile and readarray `--help` currently pass exact native stdout/stderr/status
comparisons through the real Shell. Initial readonly refusal also passes without
consuming input. The earlier remaining actual-Shell records/callbacks were deliberately
not counted as delivered while public borrowing was absent. They have now been
replayed through the actual bridge, including readonly callback effects, replacement,
exported promotion, shared descriptor aliases and raw callback bytes.

The earlier explicit-native cohort had 110 tests: 92 passed, 18 failed, zero skips.
Without prerequisites it passed 54, failed 18, and skipped 38 native-only tests.
That boundary had missing borrowed-record and byte-diagnostic type errors. Its
parser-only predecessor had 72 passing tests/types; neither historical cohort
qualifies later execution source.

## Earlier borrowed-record bridge replay

The first replay after public borrowing landed passed 107/110. Two previously
reported cases still failed (raw diagnostics and write-only descriptors), and the
old uint32-wrap fixture exposed unsupported `${!a[@]}` parser syntax before mapfile
could execute. That failing witness is retained. A separate native-qualified
indexed-read assertion confirms actual writes at 4294967295 and zero, returning
`<two><one>` without enumerating keys. No gigantic array or private-storage access
is used.

One leaf defect was reproduced with a failing test: many short skipped records
completed before an already scheduled cancellation could run. Raw-record fairness
within an individual record does not guarantee fairness across short records. The
leaf now yields every 128 record calls, covering skipped and assigned records.
The original direct test and a real streamed-producer regression pass. Reused
producer buffers and four falsey empty-chunk cancellation cases also pass through
the real Shell. Direct lifecycle coverage is now 17 passing tests. All 18 existing
option-refusal cases additionally compare actual Shell bytes/status with the pinned
oracle, not just the standalone parser.

That replay retained four core-dependent witnesses:

1. `behavior.test.ts`, raw invalid array name: native diagnostic bytes include
   byte FF; current output contains `[object Object]`. Generic proposal:
   `diagnostic(message: ShellValue)` with byte-preserving runtime prefix/output.
   This remains the sole strict-type error at the leaf call site.
2. `behavior.test.ts`, open write-only descriptor: native returns `status=0,count=0`;
   product returns `status=1,count=1`. Generic proposal: separate open-FD validation
   from readability, or admit an open descriptor lease whose read can report EBADF.
   A missing/closed descriptor must still fail during `-u` parsing.
3. `behavior.test.ts`, existing uint32 origin-wrap fixture: `${!a[@]}` is rejected
   by core parsing. Generic core array-key expansion support is needed for that
   script; actual mapfile index wrapping is independently verified as described
   above. The original failing expectation is not hidden or rewritten.
4. `prerequisites.test.ts`, callback exit ordering: an actual generic extension
   observes owner cleanup before its active `context.evaluate()` unwinds. Native
   `callback() { exit 7; }; mapfile -C callback -c1 a; printf after` terminates with
   status 7 and empty output. An actual mapfile probe instead formed a promise
   cycle: evaluate invokes shell finalization, finalization waits for the registered
   owner cleanup, and that cleanup waits for the active mapfile operation awaiting
   evaluate. The probe terminated as unsettled top-level await (Node exit 13).
   The canonical witness is a bounded ordering assertion, not a hanging test.
   Generic contract correction: propagate current-shell exit/unwind out of active
   extension evaluation before joining that enclosing invocation's cleanup.
   Skipping owned drains or swallowing callback exit is not a safe leaf repair.

That explicit-native cohort: 121 tests, 117 passed, four failed, zero skips.
Without prerequisites: 77 passed, the same four failed, 40 native-only skips.
Strict types report one error: ShellValue is not accepted by string-only diagnostic.
The mock input now declares the newly required readiness method and refuses its
use; mapfile does not poll or replace the real borrowed cursor. No global lint,
build, public-package, or complete-native-parity success is claimed.

Owned files are this document and `index.ts`, plus the five mapfile test files
`native.test.ts`, `prerequisites.test.ts`, `arguments.test.ts`, `behavior.test.ts`,
and `lifecycle.test.ts`. No shared core/input/storage, root configuration, README,
yq, sealed evidence or existing oracle helper is modified by this phase.

## Open-descriptor and byte-diagnostic integration

Before this leaf change, the new generic diagnostic API made the original raw-FF
diagnostic witness pass without changing its assertion. The baseline was 121 tests,
118 passes, three failures, and zero native skips. The sole strict diagnostic was
the lifecycle mock's missing `input.validateOpen` capability, not a production
diagnostic type mismatch.

Every explicit `-u` now calls `input.validateOpen` during option parsing. It does
not borrow a cursor at that point. A closed intermediate descriptor still fails
immediately, even if another `-u` follows. An open write-only descriptor permits
later options, help, identifier checks, and readonly-array checks to run in their
native order. Only the final descriptor is borrowed, after `openIndexed` admits
the target and applies the requested clear/origin policy. A read-stage EBADF
returns status zero without consuming input; it does not undo the admitted array
clear. An absent default FD follows this read-stage behavior, while an explicit
closed `-u` fails before array admission. Other borrow capability failures are not
silently converted into an empty stream.

Four direct lifecycle tests pin validation/admission/acquisition order, parser
failure without acquisition, unreadable input after array clearing, and an invalid
intermediate descriptor. Twelve authenticated native comparisons cover repeated
`-u`, write-only descriptors, explicit origin, later invalid options/identifiers,
help, readonly arrays, closed default/explicit input, and raw-byte FD diagnostics.
The existing write-only, raw diagnostic, array-key, and evaluator-exit assertions
are unchanged. The lifecycle mock now explicitly implements `validateOpen` and
retains its cleanup-before-acquisition assertion.

The initial additional native fixtures mistakenly duplicated the oracle's stdout
socket. Three read-stage probes reached the unchanged two-second timeout; those
incomplete measurements establish no write-only behavior. The corrected fixtures
first verify that host `/dev/null` is an existing character device, then use it as
the native write-only sink. The virtual comparison uses a memory-backed `/dev/null`
file. These tests compare descriptor/array/input effects and exact output bytes,
not device-versus-regular-file backend semantics, and create no host fixture files.
With this controlled direction, the 16 new tests had five passes and 11 failures
before implementation, then all 16 passed. The original write-only regression also
became green. No timeout increase, oracle substitution, or output normalization
was used.

Earlier authenticated cohort: 137 tests, 135 passed, two failed, zero skips.
Without native prerequisites: 83 passed, the same two failed, 52 explicit skips.
The two unchanged failures are `behavior.test.ts`'s `${!a[@]}` origin-wrap script
and `prerequisites.test.ts`'s evaluator-exit cleanup ordering witness. They remain
separate core work; no private array access, swallowed callback exit, or weakened
owned drain is used as a leaf workaround. All five author test roots typecheck
with the actual package compiler options, including strict, unchecked-index,
exact-optional, and verbatim-module checks. No new test filenames, default exports,
build changes, README edits, or global lint/public-build clearance are included.

## Independent numeric and callback-index repair

The unchanged independent `review.test.ts`, SHA256
`de03e0417aae71b088c9954575a346f2c6d3be0433a617c596aa29e61d98fccb`,
reproduced 29 passes and 23 failures before this repair. Twenty failures were
trailing CR/LF/VT/FF operands for `-n`, `-O`, `-s`, `-u`, and `-c`.
Numeric parsing now permits only space and tab after the number, while retaining
leading C whitespace, signs, range limits, original diagnostic bytes, and option
ordering. Callback source now presents its index as signed 32-bit decimal;
the storage index and its unsigned wrap remain unchanged. No test assertions or
fixtures were edited.

After these two source-line changes, the independent cohort has 51 passes and
one failure, with zero skips. The complete seven-file mapfile cohort, including
`evaluation-exit-review.test.ts`, has 189 passes and two failures out of 191 tests,
with zero skips. All seven explicit test roots have zero diagnostics under the
actual package's strict compiler options. Runtime SHA256 throughout this replay:
`ec1f113a923295f8771c182aecd6ede551440058610b128ec40940e14e97e4f7`.
The retained `${!a[@]}` origin-wrap test is a separate core failure; the earlier
evaluator-exit cleanup-order test now passes. These results are not full mapfile
compatibility or public-build/lint acceptance.

The other remaining assertion exposes a pinned-oracle truncation behavior, not
just unsigned callback presentation. With the authenticated Bash 5.2.37 executable
SHA256 `f5b331844c67482075aea7883153127668cc67f83a60a7b4362cc8469a9dc77d`,
three repeated probes at origin 2147483648 produced status zero, stored `one`,
did not call the callback, and emitted these exact stderr bytes:

```text
7368656c6c3a20737464696e3a206c696e6520313a20756e657870656374656420454f46207768696c65206c6f6f6b696e6720666f72206d61746368696e67206027270a
```

They decode to `shell: stdin: line 1: unexpected EOF while looking for matching`
followed by a space, backtick, two single quotes, and newline. Origin 2147483649
also reproduced this behavior; origin 4294967294 called the callback with `-2`
and no diagnostic. The local pinned source `builtins/mapfile.def`'s `run_callback`
allocates ten characters for the `%d` index plus spaces and the terminator.
An eleven-character negative index therefore makes `snprintf` truncate the final
quote of the quoted record before evaluation. The current leaf instead evaluates
the complete safely quoted callback with `-2147483648` and retains unsigned
storage. This remains an explicit exact-native mismatch, not an accepted parity
exception. Root must decide the policy for reproducing that truncation before
this immutable regression can be considered resolved. No oracle replacement,
diagnostic normalization, artificial error, or assertion weakening is included.

During final hashing, the independent review owner changed `review.test.ts` to
SHA256 `0ca3e200b6716ed1a13f59ac18ff11945d2ca0b28547e74ce0849abf3d573cfe`.
No mapfile test was edited by this leaf repair. Replaying all seven files against
that snapshot again produced 189 passes, the same two failures, zero skips, and
zero strict diagnostics across seven roots. The earlier `de03` snapshot remains
the provenance of the initial 29/52 red measurement and the first 51/52 replay.

## Pinned callback-capacity qualification

Root subsequently authorized reproducing the observed Bash 5.2.37 callback
capacity, superseding the pending policy decision above. This is a target-specific
observed behavior of the authenticated executable, not an all-Bash or all-platform
guarantee. The original 23-red and subsequent 51/52 measurements remain historical
evidence; neither is relabeled as a passing cohort.

Callback construction now uses the native capacity in bytes:
`callbackBytes + quotedRecordBytes + 10 + 3`, including the final C terminator.
After reserving the callback prefix and ASCII separator/index, the quoted record
is clipped to the remaining payload capacity. This removes its final quote when
the signed index needs eleven characters; it does not alter the unsigned storage
index. UTF-8 code-unit counts are not substituted for byte lengths. The source is
passed to the existing evaluator with its supported `name: "stdin"` option, which
supplies the native diagnostic source name. No diagnostic is fabricated, parser
failure is not special-cased, and callback status remains ignored before storing
the current record. Existing input ownership, cleanup, cooperative yields, and
shared evaluator source/output accounting remain in use.

New `callback-boundary.test.ts` adds 24 tests: 12 authenticated exact-native
comparisons and 12 exact admitted-source byte checks through the real Shell.
They cover origins 2147483647, 2147483648, 3294967296, and 3294967297 with ASCII,
UTF-8, and raw invalid-UTF-8 callback prefixes. Records include UTF-8 and a single
quote. Two records per case verify crossing into and out of the eleven-character
range, unsigned cell storage, callback effects, and the following unread record.
At origin 3294967296, the first callback is clipped and fails parsing, while the
second executes with index `-999999999`; storage and final mapfile status remain
native-compatible. The source-capture checks also return status 2 from evaluation
and verify that both unsigned cells are still published.

The new tests initially had six passes and 18 failures against the signed-index
repair. Byte-capacity clipping made all 12 source-byte checks pass; nine native
boundary cases and the original reviewer regression still failed only because
the evaluator's default source name omitted `stdin:`. Supplying the existing
evaluator name made all 24 boundary tests and all 52 unchanged reviewer tests
pass, with zero skips. This required no core edits or normalized comparisons.

Final eight-file mapfile replay: 215 tests, 214 passes, one failure, zero skips.
The sole failure is the retained `${!a[@]}` origin-wrap core case. All eight
explicit mapfile roots have zero diagnostics with actual-package strict compiler
options. Without native prerequisites the new file reports 12 passes and 12
explicit skips; it reuses the existing authenticated Bash helper, so malformed
supplied prerequisites are not treated as absence. Runtime remains at the `ec1f`
hash recorded above, and the independent review stays at the `0ca3` hash. The
read diagnostic review and all existing mapfile tests are unchanged by this work.
Root must register the new test literal and coordinate independent reapproval;
no default exports, builds, lint gate, README, or commit changes are included.

## Opt-in array-key syntax integration

The mapfile factory now directly declares the generic
`syntax: { arrayKeys: true }` capability. It does not import `arraysExtension`,
proxy another factory, or add a builtin. Both `mapfile` and `readarray` therefore
enable `${!a[@]}` through their existing shared opt-in factory. Co-installing
`arraysExtension` in either order uses the core's identical-capability
deduplication. Constructing either factory does not enable syntax in a default
Shell that has not installed an extension.

Against mapfile source SHA256
`29d7e2a959612901041d090ab48e26ce2f2ea674fb12e5d7e9a0a5b643dafdb8`,
the original immutable `behavior.test.ts` uint32-origin-wrap script reproduced
status 2 instead of zero. New `syntax.test.ts` covers direct mapfile/readarray
keys and unsigned storage, both co-installation orders, subshell/substitution
inheritance, factory metadata, and the disabled default. Its first draft
incorrectly expected the words `syntax error` for the default refusal; the
observed unchanged diagnostic was `shell: Unsupported parameter expansion at
offset 30` followed by newline. Correcting only that new fixture expectation
left three passes and four implementation failures before the factory change.
The identical seven tests then passed, including five authenticated Bash 5.2.37
comparisons. Without prerequisites they report two passes and five explicit
native skips. The original wrap assertion now passes without modification.

The complete nine-file mapfile cohort moved from 229/241 passes with 12 failures
to 234/241 passes with seven failures, both with zero skips. All nine explicit
roots typecheck with zero diagnostics under actual-package strict options.
The seven retained failures are the independent review's diagnostic-origin
cases: nested clipped function callbacks; runtime errors in callback-defined and
previously defined functions; named-source function runtime and nested-callback
errors; the direct-function control; and the named-function eval callback.
These remain separate core work, not suppressed failures or a full leaf-green
claim. Existing independent review SHA256
`879f9c9d9eb378b1f038a86736333d1052e416449fa16905902d067d494a14fd`
and callback-boundary SHA256
`41e02a3808ea5bdd9d694cca044f5f8c0ea06397fffbc7cf4b1f2d7f11bcec40`
remain unchanged by this integration.

This qualification depends on the current independently owned core, not only
the leaf: final runtime SHA256
`e72bd25e6866a191b8eb067cd3e4da133321251f2fbb79fc1af293bf403df7ef`,
extension API/capture SHA256
`f319df600aea8da12a23863dad68d76237640b58171e182b7afe3d4b40d3ddba`,
and arrays factory SHA256
`c1408dfd59e1375a1c559ba6b05b9bf55d9d777d5e89d106456836be2b67da40`.
No core, existing tests, read-review file, configs, exports, discovery, build,
lint, README, or commits were edited. Root owns registration of the new
`syntax.test.ts` literal and subsequent integrated acceptance.

## Primary 5.3 migration and current qualification

Before migration, the original source, all nine mapfile fixtures, shared 5.2
helper, SEMANTICS, and both profiles' raw captures/replays were preserved without
overwriting earlier evidence in
`/tmp/safe-bash-mapfile-primary-migration-Msfbtb`. The 22-file archive manifest
SHA256 is `7a630aac1e3ede47a104e585425f2271eb2e11797d005f743581f8364f8b4948`.
Earlier 5.2-specific measurements and decisions in this document are historical,
not authority to override the established primary 5.3 behavior.

The original import-only profile experiment used immutable core commit
`4a516d97018ea6e451ca062da65e3cced13b2b0b` plus the exact mapfile leaf. It observed
234/241 passes under 5.2 and 218/241 under 5.3, with no skips. The 5.3 failures
were 20 numeric-whitespace differences and three source-coordinate core gaps.
Four 5.2-only function-label failures disappeared under 5.3; no global
`environment` label override is appropriate. All 24 callback-boundary tests
passed under both profiles, so byte-capacity clipping remains unchanged.

All 170 captured requests were rebound by an import-only replay of the original
fixtures, verifying exact equality of the request multiset. Repeated requests
had consistent observations. Canonical migration changes only the seven native
reference imports/calls, their prerequisite gating, and explicit version labels.
Every raw `assert` call text was checked against its archived original and is
unchanged. No program, byte assertion, descriptor fixture, or callback effect was
weakened. The two non-native-consuming fixtures are unchanged.

On the current core coordinate repair, the migrated primary suite reproduced
exactly 20 numeric failures: 221/241 passed with zero skips before the source
change. GNU 5.3 accepts trailing CR, LF, VT, and FF for `-n`, `-O`, `-s`, `-u`,
and `-c`, whereas the pinned 5.2 profile rejected them. The one-line parser repair
restores trailing C whitespace admission without altering limits, signs, option
order, raw diagnostics, or unsigned index storage. This intentionally differs
from the earlier 5.2-specific repair; the old differences remain preserved, not
relabeled as passes. The full primary cohort then passed 241/241 with zero skips
and no oracle environment prerequisites. Five additional bounded protocol checks
covered exact lookup, rejection of unknown fixture/program/stdin, and independent
returned byte buffers; they are not included in the 241 count.

The nine original test roots had zero strict diagnostics before migration and
afterward under actual package compiler options, including the new reference
loader's transitive types. Two passing live-source replays could not establish a
frozen-core result because the core owner changed the parser during their guard
windows; their TAP files and before-hash records remain in the migration archive.
Final validation therefore copied the current exact dependency closure, without
import/body edits, to `frozen-qGb1zo` within that archive. The copy was authenticated
against the original files before execution and unchanged afterward. It passed
241/241, zero skips, and all nine strict roots with zero diagnostics. The four
installed external dependency files were also hash-checked before/after, and no
live-source drift was detected during this final run.

Final composite runtime SHA256:
`33b2c38825fdac6892b79cd0e42b8e14bd29f6b5af7e6c93ef724effd96ae0a7`.
Final composite parser SHA256:
`a9263b877687b2f9d803ce6bc717c69b040f8790402b6e24b17078c1f5084bad`.
The full dependency, fixture, reference, and test-output hashes are recorded in
`/tmp/safe-bash-mapfile-primary-migration-Msfbtb/frozen-qGb1zo/validation.json`.
This is an explicit frozen-composite qualification, not approval of later live
core changes or an archive/public-build gate. No source outside mapfile, root
configuration, export, discovery, build, lint, README, or commit was changed.
