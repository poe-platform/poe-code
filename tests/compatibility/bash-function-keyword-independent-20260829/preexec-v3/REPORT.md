# B35 v3 corrective preexecution review

Date2026-08-29. **F01/F02 corrective checks pass; narrow SOURCE HOLD remains
for partial-open double-fault precedence (S01).** No actual campaign authority.

Author source `d97a038f742ac06872a30a7c0dd27ea7ab86b640`, evidence
`475d165b49f7fbfef49254d2fbcd8314db3b0f81`. Runtime PRESEAL9140 bytes,
SHA256 `60f526f043e7e94b1526f8146d792b342a148efb261ffb3435dfb8b5ea2cc1ff`.
Independent preseal SHA256
`8579cdb10bbb87c64521227a237c4ef90e4e5010fd8eb5bff1b0dae431b08bcb`.

## Actual permitted observations

- Exact author D01–D18 assertion block:18/18 pass.
- Prior N01–N08 assertion bodies with explicitly versioned v3 valid-grant metadata:
  8/8 pass. Missing/nonnumeric-time refusals now pass; original v2 N02/N03
  failures remain untouched. No expectation changed to accept malformed grants.
- H19/H20:2/2, both status0, observed exit/close and stdout/stderr EOF, zero known
  outstanding child handles. Each stdout20 bytes. H19 stderr756 bytes retains
  explicit undefined/null/false/0 primary/secondary records; H20 stderr0.
  Both capture pairs were flushed, hashed and closed.
- Pure controller PID22775 exit0/close0; readiness children22776/22777. Parent
  retained74 bytes,34 postguards passed. The50229-byte fixture archive retains20
  files; the exact owned temporary tree was removed after archive publication.
- Zero product/parser/engine imports, Workers, compiler/build/install, actual
  owner/collector entry execution,54 primary,24 legacy or5 mutant calls.

The Node pure controller uses the real collector-core/runDirect primitive for
the two harmless entries. It does not execute launch.sh, the product collector
or supervisor. Synchronous-hook traces are for tiny fixture modules, not a
product nested-load trace. Regular-file completion, pipe EOF and process
retirement remain distinct observations. No global/group census is inferred.

## F01 closed within SOURCE/PURE scope

activation.mjs admits exact own-data fields and safe finite nonnegative integer
times before arithmetic. It binds schema/decision,54 calls, exact preseal/work,
limits/roles and a40-hex independent review commit. Missing, undefined, null,
boolean, string, nonfinite, fractional and unsafe times refuse. Accessor fields
refuse without invoking their getter. Prototype identity is not required.

Fresh GO must use schema b35-runtime-grant-v3 and satisfy:
issuedAtEpochMs≤started≤now≤latestStartEpochMs;
latestStartEpochMs=expiresEpochMs−1500000;
expiresEpochMs−issuedAtEpochMs≤3000000.
Final deadline is min(started+1500000,expiresEpochMs). No actual timestamps are
issued by this review; template nulls remain non-executable. Both collector and
owner validate. Dispatch needs enough margin for both checks; no expiry waiver.

## F02 repaired normal route, with exact bootstrap limits

launch.sh's constant umask077/set-e/noclobber setup precedes FD redirection;
redirection precedes env/Node collector startup. Node/preauth errors after that
point have a declared regular-file route. The collector opens exclusive owner
stdout/stderr captures before owner spawn; owner process output is now captured
rather than relying on unrelated open descriptors. preauthRecord preserves
raw falsy presence/values; finalization/owner-finalization bytes are unchanged.

Initial host/tool startup, zsh startup and a failure while establishing the
redirections remain outside those internal capture files. In particular, a
second redirection failure may use the inherited stderr; -f does not suppress
the already-running tool shell's startup. Root must retain its trusted external
startup observation rather than claim all pre-open failures were captured here.

For an ordinary second owner-capture-open failure, source calls close on the
first descriptor before leaving. The double-fault path below is not covered by
the18+8 controls or these two successful entries. No blanket native-FD fault,
RSS, opaque-provider or machine-wide cleanup acceptance follows.

## S01 — inherited partial-open cleanup masks primary

Exact frozen `direct-child.mjs:13`:

```js
try {stdoutFd = fs.openSync(spec.capture + '.stdout','wx+',384); stderrFd = fs.openSync(spec.capture + '.stderr','wx+',384);} catch(reason) {if(stdoutFd!==undefined)fs.closeSync(stdoutFd);throw reason;}
```

If stdout opens, stderr-open rejects with primary A, and the cleanup close
throws B, the unguarded close replaces A before `throw reason` is reached.
For example, A=undefined and B=false would select false, not the original
undefined. This is a SOURCE control-flow counterexample, **not an executed
native-FD failure, additional pure test, observed leak or product defect**.

The function already creates a Primary holder before this block, but the
capture-open catch bypasses it. This helper is byte-identical to v2; the new
collector relies on this path. Thus successful repair of the earlier activation
and stderr-routing findings does not establish this acquisition-fault priority.

Minimal author/root action: preserve the selected open failure through the
cleanup attempt, separately retain/report the close failure and unknown
descriptor disposition, and prohibit dependent acquisition. A bounded injected
double-fault control would need a new preseal/authorization; none was added here.
Alternatively ROOT must explicitly adjudicate the narrower FD-fault profile.
No author or production code was edited.

## Identity and future finite plan

Parser52b6711e888361015acc38017be2a6b08509d8a7 and composition
1f4c5f4e25e0302146cf2735e4164ee09eb73a390a98d56ac33b94e6e57c16fd
are unchanged. The978812-byte,1002-member package was stream-authenticated
against275a6c1006a5986d9d878a2344b95158fc320187a07a1d7f25584c10d7e7959d,
without inflation/import. Node/zsh/env tools were stream-authenticated; zsh/env
were not executed as test subjects. Supervisor's only change from v2 is the
65536→196608 administrative capture reservation in its two ledger fields.

Correct current source qualification: Sagan a505f302 accepted e013 SOURCE, and
ROOT c9326e1726b58ff17a15da4c80f637e174148574 accepted full305 SOURCE/PRODUCER.
The earlier pending-Sagan statement stays historical; this is not runtime/B35
acceptance or rescoring of any previous cohort.

65 runtime known starts = collector1 + owner1 + build1 + types3 + primary54 +
mutants3 + binding refusals2. Seven administration slots retain72 maximum.
Peak3 is collector+owner+one sequential child. Shell/env exec replacement adds
no concurrent PID. Primary children contain24 legacy comparisons; with five
mutant calls this is83 planned Shell.exec invocations, not83 process starts.
Subprocess/Worker case permissions and async loader threads remain zero.

25min inclusive;60s inner finalization tail; collector5s retirement/publication
reserve; case30s/build120s.96MiB capture/512MiB sampled logical task work;
196608 reservation is inside96MiB. These are scoped logical bounds, not RSS or
all-descendant guarantees. Post-exit bootstrap capture completion belongs to a
declared administration slot after directly observed retirement; do not relabel
the preparation helper's192MiB sampling profile as a whole-product guarantee.

Pending command, **not authorized by this HOLD**:

```sh
exec /bin/zsh -f '/Users/kjopek/Workspace/safe-bash/tests/compatibility/bash-function-keyword-author-20260829/preexec-v3/launch.sh' '9140' '60f526f043e7e94b1526f8146d792b342a148efb261ffb3435dfb8b5ea2cc1ff' 'ROOT_APPROVED_GRANT_SHA256' 'INDEPENDENT_REVIEW_SHA256'
```

Only the two digest slots and versioned GO.json/REVIEW.json are mutable
activation inputs. Root must provide valid fresh timestamps and resolve this
HOLD; reauthenticate all tool/source/role/command bindings and exclusive capture
slots immediately before dispatch. No grant or absolute window is inferred.

Old0/54 startupSTOP, v2 HOLD and literal N02/N03 failures remain unchanged.
Actual54/24/5 calls and all runtime/types/mutant/binding gates remain UNRUN here.
