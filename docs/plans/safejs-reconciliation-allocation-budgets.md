# Reconciliation allocation budgets

Status: validated main defect, repair under qualification. Separate this from
the still-isolated pending imported-Promise checkpoint feature. Releases held.

## Evidence

Pending prototype proof-budget tests initially put a zero-retained-data assertion
in finally, masking the relevant failures. That assertion was not justified:
the test still held the decoded Promise/value and its compilation ownership.
Removing the unrelated cleanup assertion exposed two concrete failures (7ab552):
a 17-character string passed stringLength=16, and a five-element array passed
arrayLength=4. Boundary controls passed; dataSize=10000 rejected 20000 characters.
This does not establish a memory leak from the initial cleanup observation.

The same string/array bypass reproduced against main's ordinary HostCallJournal
reconciliation (eabd8c): two failures and two boundary-control passes. The first
repair validated a copied outcome within retention and passed the four main
cases plus five prototype cases. Additional fulfilled/rejected and hidden-data
controls exposed another gap: two hidden-string cases still passed (ae82ab).

Direct allocateProducedSandboxValue tests then reproduced four failures
(99f835): hidden data was not checked on records or arrays, and enumerable
getters were invoked on both. A sparse-array/cycle control passed.

## Repair

Produced-value allocation now reads own string-keyed property descriptors on
records and arrays, including non-enumerable data, without invoking accessors.
Mapped arguments retain their dedicated handling. No timeout or budget is raised.

Reconciliation validates the original proof value/reason with that accessor-safe
allocator before settlement. Checking only the copied outcome was insufficient:
ordinary data copying omits untracked native non-enumerable properties, while
reconciliation returns the original proof outcome. The final approach does not
add settlement flags, change proof identity, or duplicate normal host-call checks.
On rejection, no outcome is installed and record lifecycle/data accounting stay
unchanged. Both fulfillment and rejection proofs have boundary tests.

## Required qualification

Main session 17804 covers the new regressions, existing host journal/disposal,
host bridge, structured-clone accessors and argument-accessor budgets. Collect
terminal results before claiming success. Scoped lint, TypeScript, broader
allocation callers and maintained build/native imports remain required. The
pending prototype has the same repair but must rerun its proof budget and
checkpoint cases. No commit, push or release is claimed for this change yet.

Main focused qualification completed successfully: 106 tests across seven files
passed (97a689). This includes all twelve fulfilled/rejected proof cases, five
direct allocation regressions/controls, journal/disposal, host bridge, structured
clone accessors and argument-accessor budgets. Scoped ESLint is running as 57738;
the maintained workspace build is 11192. Both were started after that test run
terminated. Keep main runtime fixed while they run; neither is yet a passing
result. The user's staged Safe-Bash paths remain unchanged (0a8f88).

Scoped ESLint completed successfully (bcfad6). The maintained closure passed all
23 builds and five fresh native ESM import checks (3df61b). The broader
structured-clone/Reflect/boxed/arguments selection includes the unchanged camera
file, with one worker and no concurrent build/lint. Its report target is
`/tmp/safejs-reconciliation-allocation-callers.json`; collect the terminal result.

The broader caller run completed with 338 passes and seven intentional skips
across 23 files (92cdbb). All eleven unchanged camera tests passed in this run.
This does not erase previous camera timeouts or prove CI reliability. Combined
with the 106 focused passes, scoped lint and maintained build/native imports,
this qualifies an atomic local reconciliation-budget repair. The last full
package gate remains non-green and predates this repair. Commit only host-call.ts,
values.ts, the two new regression files and this plan. The isolated pending-node
format and its tests must stay out of that commit.
