# csvkit temporal independent stress QA

Use a different agent from the engine author. Execute the registered safe-bash
commands through Shell using MemoryFileSystem; preserve source bytes and compare
exact stdout, stderr and status. Do not use Python, programs or disk files inside
canonical tests.

1. Measure new cases with the frozen CPython 3.14.2/csvkit 2.2.0 development oracle
   under LC_ALL=C, LANG=C, TZ=UTC, UTF-8 pipes and an 80 by 24 terminal profile.
2. Add exact original differential cases before implementation fixes. Run the
   maintained safe-bash test selector for csvkit-temporal-stress.test.ts and report
   failing cases to the engine owner.
3. Stress Boolean grouping/Unicode whitespace, Text preservation and nulls,
   leap-day Date inference, explicit date versus number precedence, duration
   expression sorting/output, and timezone-aware DateTime ordering/output.
4. Rerun after engine integration. A blocker, skipped or unmeasured case does not
   count as a pass. Record qualified cases separately from outstanding surfaces.
5. Keep full strptime directives, parsedatetime relative-clock behavior,
   non-English Babel/CLDR locales, temporal JSON/SQL
   conversion and cancellation/backpressure outstanding until independently
   measured and exercised. Never infer their qualification from simple sort cases.

The independent canonical cases live in
`packages/safe-bash/tests/commands/csvkit-temporal-stress.test.ts`. Before temporal
integration, six of the first twelve measured cases pass and six reproduce the
explicit TimeDelta qualification blocker. Subsequent measured cases include
fractional DateTime output, explicit DateTime offset formatting, csvformat's
number-only inference and the exact mixed naive/aware sorting domain error. This
baseline records failing original regressions; it does not qualify final delivery.

After rebuilding the domain integration, the focused canonical run
`node --import tsx --test packages/safe-bash/tests/commands/csvkit-temporal-stress.test.ts`
passes all nineteen cases with zero skips in approximately half a second.
The maintained safe-bash npm test route with a test-name pattern discovers all
1,205 active files and loads them before filtering. That baseline attempt failed
the original temporal cases and reported a network/http.test.ts file failure,
then remained in that file for more than two minutes. The agent terminated only
its own test processes. That maintained attempt is incomplete/failed and does not
establish a passing workspace gate. The focused nineteen-case pass qualifies
only the exact recorded cases.

A bounded direct reproduction identifies the unrelated filtered-route failure:
when no network/http tests match, Node 22 skips the `before` hook but invokes its
`after` hook. The uninitialized `host.close()` at
`packages/safe-bash/tests/commands/network/http.test.ts:7` produces
`hookFailed: Cannot read properties of undefined (reading 'close')`, and the
filtered child does not settle within ten seconds. This is a concrete filter
artifact, not evidence of a csvkit failure or a clean maintained gate.

Additional frozen measurements cover Unicode 17 case-pair rejection by the
Unicode 16 null profile and typed csvjson Boolean/Date/TimeDelta/Text/null and
mixed naive/aware DateTime serialization. The twenty-three-case pre-JSON-fix run
has twenty-one passes and two original typed-JSON qualification blockers. Rerun
after the JSON engine is rebuilt before claiming those two cases pass.

Final independently executed integration run:
`node --import tsx --test 'packages/safe-bash/tests/commands/csvkit*.test.ts'`
passes 167 of 167 cases with zero failures, skips or cancellations in about three
seconds. This includes all twenty-five measured temporal/Unicode/JSON/default-SQL
stress cases. The default SQL cases compare exact SQLAlchemy-compatible schema
bytes, including nullable DateTime, TimeDelta mapped to DATETIME, Boolean, Date,
Text and Decimal columns, without any database acquisition or filesystem effects.

Two historical blocker expectations were reproduced against the current engine
and updated within specifically assigned test ownership. Mixed Number/Text
csvsort now compares the frozen successful result; the help/preflight test keeps
its no-stdin-acquisition requirement and uses the still-explicit csvsql database
execution/transactions blocker. No test was removed or skipped. The earlier
failed/incomplete maintained name-filter run remains recorded separately and is
not superseded by a claim of a clean whole-workspace gate.
