# Temporal implementation validation — 2026-09-18

The engine implements the measured boundary in
[the temporal specification](../specs/csvkit-temporal.md). Full csvkit, Agate,
locale/date dependency and service parity remain unfinished. Every remaining
surface in that specification is a blocker, not an inferred pass.

## Original failures and corrections

The original five domain regressions failed with status-78 temporal parser
blockers. The independent Shell cohort initially passed six Boolean/Text cases
and failed six measured Date/TimeDelta/DateTime cases. After source casts were
implemented, the adapter still exercised the old built SDK until the maintained
workspace build ran. Subsequent actual-Shell failures reproduced explicit en_US
format blocking and Date inference incorrectly blocking a datetime candidate.
Those regressions were corrected without changing the fourteen executable names.

Further original domain regressions reproduced Unicode 17 versus 16 null-case
matching, binary float duration rounding, Unicode duration digits/whitespace,
compact strptime width alternatives, required format whitespace, distinct
parsedatetime/strptime year pivots, implicit Date no-match diagnostic selection,
missing partial-DateTime clock admission and negative-zero timezone output.
The native reference supplied concrete source/cast/CLI evidence before fixes.
Typed JSON and generic SQL DDL first failed their original inference guards,
then passed measured original regressions after engine integration.

The independent reviewer also reproduced two obsolete historical blocker
assertions. Mixed numeric/plain-text sorting is now supported by measured casts;
its test now checks the frozen original success. The no-stdin-acquisition test
now uses csvsql's explicit connection execution blocker, preserving its safety
assertion rather than removing/skipping it. The reviewer owned these test edits;
root retained product/integration/export/Git ownership.

## Reference and provenance

The hash-required CPython 3.14.2 runtime lock was replayed in an owned out venv.
Relevant versions are Agate 1.14.2, Babel 2.18.0 / CLDR 47, parsedatetime 2.6,
pytimeparse 1.1.8, isodate 0.7.2, agate-sql 0.7.3 and SQLAlchemy 2.0.54.
Source paths inspected: Agate data_types/{base,boolean,text,date,date_time,
time_delta,number}.py; pytimeparse/timeparse.py; CPython _strptime.TimeRE;
agatesql/table.py; csvkit/utilities/csvstat.py. Existing verified distribution
source notices remain in material-notices-20260917.json. No Python reference
code or subprocess fallback is invoked by product execution or canonical tests.

A final independent, empty-environment native replay used exactly LC_ALL=C,
LANG=C, TZ=UTC, PYTHONIOENCODING=utf-8, COLUMNS=80 and LINES=24. It verified
CPython 3.14.2's executable SHA-256
`3d6400b63b150164e89a690d9813af8b0eb420af9f336ef1f6c5102c6da60eae`,
Unicode 16, six temporal/case assertions and two exact CLI stdout/stderr/status
assertions. This eight-case replay is distinct from the larger development
measurements and is not a full installed-manifest or full-suite requalification.
The separately inspected C output locale has decimal dot, empty thousands
separator and empty grouping. en_US remains the input numeric default.

Frozen lowercase profile SHA-256:
`159e586b3eecc98789c9578a91278344fca8d9ce9575d11aa36b2755d8f29627`.
Its 1,460 mapping records are queried from CPython's Unicode 16 lowercase;
152 and 452 compact ranges encode effective final-sigma scan classes.
This data addresses a demonstrated Node Unicode 17 divergence and does not
certify every other Unicode operation in the command suite.

## Final checks

- `npm run test --workspace=@poe-code/csvkit`: 32 files, 1,631 passing tests,
  five existing encoding TODOs, status 0. TODOs are not passes.
- `npm run lint --workspace=@poe-code/csvkit`: ESLint and both maintained
  TypeScript configurations pass, status 0.
- `npm run build:workspaces -- --workspace=@poe-code/csvkit`: maintained
  dependency closure builds office-package and csvkit, status 0; uncached.
- `node --import tsx --test packages/safe-bash/tests/commands/csvkit*.test.ts`:
  167 passes, zero failures/skips/cancellations, approximately three seconds.
  The separate reviewer cohort includes 25 measured temporal/Unicode/typed
  JSON/generic SQL cases. This finite selection is not a full Bash workspace gate.

The maintained Bash npm name-filter route loaded 1,205 files and failed/hung
in network/http.test.ts: filtered setup was skipped but its after hook accessed
an uninitialized host. The reviewer reproduced the failure and terminated only
its own processes. That route remains failed/incomplete and is recorded in
[the independent QA record](../plans/csvkit-temporal-stress-qa.md).
Repository-wide checks and full Bash workspace qualification are not claimed.

An ad-hoc terminal screenshot of actual registered Date/aware DateTime sorting,
typed JSON and SQL schema output was inspected. All four operations returned
status 0 with correct displayed CSV/ISO/DDL. An initial capture used an invalid
harness setup and result property names; it displayed status127/undefined and
was rejected as harness evidence, then corrected using Shell.use and inspected
again. No screenshot tests or new visual styles were introduced. Owned venv,
logs, visual helper and PNG captures were purged after reduction; unrelated out
artifacts were preserved. No README edits, staging, commits, push or publication.
