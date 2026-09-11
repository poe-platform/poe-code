# Tracked intrinsic object tables

The camera timeout remains reproducible intermittently without changing its
5000ms timeout or full native/fixture comparisons. A fresh unbundled baseline on
2d1ce6365 ran the first fixture four times in 2426, 2180, 2114 and 2457ms. Profile:
`/tmp/safejs-camera-array.ZILQyG/baseline.cpuprofile`. Aggregate self samples show
3636ms in measurement visit, 1828ms in intrinsic retained capture and 863ms GC.

Unlike the rejected bulk-descriptor and lazy-empty-capture experiments, this
candidate changes table ownership: internally created Math and numeric typed-array
prototype objects have tracked mutation traps, reusing the existing function-table
revision mechanism. Raw external intrinsic tables remain rescanned. Factory inputs
are copied so callers cannot retain an untracked alias to the backing table.

TDD: unchanged Math required 47 descriptor reads and the Float32Array/shared
prototype pair required 40; both new zero-read assertions initially failed. Both
pass with the candidate. A copy-boundary test then exposed rejection of these
internal proxies; only factory-owned objects are now allowed through that guard.
Arbitrary host proxies remain rejected. Mutation, hidden symbol/accessor/flag,
freeze, backing-table alias and JSON snapshot controls are included.

Initial focused selections pass 62 and 34 tests, with three overlapping tests.
All three maintained camera cases pass in the first selection. Candidate built
timings, broader verification and delivery are still pending. This is not yet a
demonstrated speedup or a verified CI timeout fix. No visual CLI change is intended.

The selected 23-workspace build and all four built-import checks passed. Same
unbundled format, same four first-case executions and complete native/fixture
assertions: candidate 2157, 2095, 2069, 2161ms, approximately 2.12s mean versus
2.29s baseline. This is a modest local improvement (~7.6%), not a CI guarantee.
Candidate profile `/tmp/safejs-camera-array.ZILQyG/candidate.cpuprofile` attributes
1317ms self time to intrinsic capture versus 1828ms baseline; GC 625ms versus
863ms. Measurement visit remains dominant (3751ms versus 3636ms), so the broader
accounting cost has not been eliminated.

Changed-file ESLint and TypeScript checks pass (the snapshot test needed an
explicit success guard for type narrowing). A built Node 18.18 probe observes
both Math and Float32Array prototype mutations correctly. The maintained SafeJS
workspace unit route is now running with only the two already documented open-gap
exclusions: promise-import-properties and weak-collections. Those remain failures,
not passes; no new exclusion was introduced. No candidate commit or push yet.

That package run finished with 19,669 passes, 41 skips and one 5000ms timeout in
the 600,000-element push-spread test; all camera cases passed. Kept that failure
visible. Temporarily removed only this candidate's runtime diff, then delivered
the independently verified native-array capture improvement as remote-main
46aa46a9cafb692689b35a02412eeda03c346ab6. Its plan records the reproduction and
559 focused passes. Reapplied this candidate unchanged over that commit; combined
package verification is restarting. No tracked-intrinsic commit or push yet.

Combined maintained package verification passed: 19,675 tests, 41 skipped,
639 passing files and one skipped file, 413.51 seconds. Both camera and large
push-spread controls pass, with unchanged limits and inputs. Only the two
documented open-gap exclusions remain. A fresh selected workspace build of the
combined source is running before the tracked-table commit and push.

The final combined 23-workspace build and four built-import checks passed. Ran
the freshly built SafeJS CLI with --help through the maintained screenshot route
and inspected `screenshots/node-packages-safe-js-dist-cli.js-help.png`: usage,
options and exit codes are readable. This is a CLI visual smoke check, not an
agent/model execution. Earlier changed-file lint/types remain valid for the
unchanged reapplied candidate; runtime verification now includes the array fix.
