# H11.2 supervisor fault controls — preseal

Date2026-08-28. ROOT authorizes a narrow supervisor fix after source mapping
77f80adc35877da619ff16881b6155d9bb9d17cb. This recipe precedes successor code and
execution. Original e35 supervisor SHA256
87837c2ff91182fc7b1b45f3d0b0ae54b7e1af66f289bd581d20a6cb5938773b is inherited,
not a new e35 regression. Original independent38PASS/0FAIL/2UNEXECUTED stays.

## Source and isolation

Only launcher-v3/supervise.mjs and DRIVER reseal, plus this test/evidence scope.
No product, frozen helper, f5/c109, eligibility/profile, permission, fence,
observer protocol or private-finally source changes. H06.3 remains SOURCEQUALIFIED
if terminal persistence succeeds; actual dual-private-error execution UNEXECUTED.

Load the COMPLETE source module using vm.SourceTextModule. Assert/path link to
real fixed Node builtins; child_process/fs/timers and process/clock globals link
to explicit synthetic fakes for S controls. No source extraction/reimplementation
of supervise, no arbitrary dependency import. Original source may be linked ONLY
synthetically to characterize the failure without creating a real survivor.

## Presealed S groups (no OS/process proof)

1. S01 original exact module: first observation throws A, finally observation B;
   record replacement/absence of teardown with fake child. Never run it live.
2. S02 repaired initial+cleanup faults retain both causes, including null and
   undefined, attempt known child teardown, close/drain and return nonclean.
3. S03 initial successful ownership observation, later observation failure: do
   not blindly signal stale/foreign identities; known child handle still retires.
4. S04 clean child: exact stdout/stderr/status, no signals, no false faults.
5. S05 onSpawn sync failure and observation failure preserve primary/secondary;
   output captures and mandatory cleanup are still attempted.
6. S06 data write/error and end/reporting failures cannot bypass child teardown
   or replace earlier causes; failed capture never qualifies clean.
7. S07 setup/total watchdog and caller cancellation trigger bounded known-child
   termination; handlers/timers stay owned until cleanup attempts complete.
8. S08 observer failure during timeout/signaling cannot escape timer callbacks.
   Signal failures remain recorded; no guessed foreign/group signal.
9. S09 unresolved synthetic child/stream at cleanup deadline returns explicit
   closed/drain/observation uncertainty, never success; no unbounded await.
10. S10 recovered final observation does not erase earlier observer failures;
    final-only metadata fault also makes result nonclean.
11. S11 throwing null/undefined/primitive/object/error retain raw cause identity
    and JSON-safe typed descriptors (undefined is not silently omitted).
12. S12 all signal/abort/data/error listeners and capture operations are owned;
    no global timer/listener leak or unrelated sibling signal in fake traces.
13. S13 supervisor source, dependency set, unchanged driver siblings/profile/
    candidate/bounds and changed reseal authenticate; import is inert.

## At most three real harmless owned Node children

Use the same complete successor module, real fs/path/timers/spawn and admitted
Node builtins. Replace only observation execFileSync to inject declared faults;
successful observations call ONLY the admitted exact /bin/ps command below.
The outer harness wraps spawn BEFORE supervise receives its child, tracks its
actual ChildProcess handle/PID/exit/close, owns a separate2s rescue timer, and
always attempts cleanup/reaps in finally. No original faulty supervisor live run.

- R01: Node `-e "process.stdout.write('owned-positive\\n');setTimeout(()=>{},40)"`.
  Expected natural0, exact output, no signals, complete captures, clean result.
- R02: Node `-e "setTimeout(()=>process.exit(0),500)"`. First observation throws
  null; subsequent observations throw undefined. Mandatory known-child signal/
  close/drain, both causes, unknown observability/nonclean. No kernel-drain claim.
- R03: same500ms child; observations work until actual child close, then throw
  Error('post-close observation failed'). Natural child completion but explicit
  observer failure/nonclean result; successful child exit is not clean admission.

Exact Node executable /Users/kjopek/.nvm/versions/node/v24.11.1/bin/node,
SHA2564255a388254ca4319e2f95f1da375d5deaddf25baf9c7c85070b67f9543b15d0.
Exact observer /bin/ps,
SHA2561e46cdb824858eb32e4c85ca920ba31b4541a814a133980d8b3484f39942276c,
argv ['-axo','pid=,ppid=,pgid=,lstart=,command='], timeout<=2000ms, output<=8MiB.
Both identities already occur in fixed EXTERNAL.json; verify bytes BEFORE use.
No lsof/native chmod/private/setup/build/gate. No new permissions or routes.
Child environment finite: PATH=/usr/bin:/bin, LANG/LC_ALL=C, TZ=UTC,
HOME/TMPDIR under unique owned temporary root; no NODE_OPTIONS/DYLD/LD injection.

Each real child is finite by its own40/500ms timer; supervisor total<=1500ms,
cleanup<=5000ms, outer rescue2s and outer close bound7s. Whole control run<=45s,
capture<=64KiB/child and2MiB/cohort. Outer only signals its own still-open direct
ChildProcess handles, never other PID/groups. Actual signals, statuses, close,
capture failures, observer faults and any rescue actions are recorded. A failure
stops subsequent actual children; no alternate route/retry. Captures retained.

Synthetic time/ownership cannot certify OS behavior. Three real children do not
prove arbitrary descendants, uncooperative host/kernel teardown or shipping fence
protection. No full gate GO; source/evidence require DIFFERENT Dirac review.
