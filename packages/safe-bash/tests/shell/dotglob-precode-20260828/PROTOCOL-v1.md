# Dotglob precode reference protocol v1

2026-08-28. Reference-only data; not a canonical test, product implementation,
normative freeze, comparator run, or acceptance. Only this new directory and
task-owned temporary receipts/fixtures may be written. No dependencies installed.

## Seal and oracle

Before the first Bash invocation (including version queries), atomically commit
this protocol, ROWS-v1.json, BINDINGS-v1.json, runner.mjs and MANIFEST-v1.json.
MANIFEST binds all other files; its own identity is the full protocol commit.
Runner verifies committed bytes against live bytes and manifest hashes, then
checks the exact qualified executable and local primary manual hashes inherited
from the published LET design BINDINGS. Any absence/mismatch stops preparation;
no replacement, installation, build, download, or repair is authorized.
The existing recorded version is reused; no separate --version execution.

Run `node tests/shell/dotglob-precode-20260828/runner.mjs --prepare COMMIT`, then
only after success `node tests/shell/dotglob-precode-20260828/runner.mjs --run COMMIT`.
Preparation exclusively creates /tmp/dotglob-precode-20260828-ready.txt with the
full commit, tool hash, row count, unique output/fixture roots and checkpoint.
Execution verifies that receipt and seal again and exclusively claims RUN-ONCE.
There is no retry mode. Failed runs and partial captures remain. A runner defect
requires a new protocol/version and root disclosure, not recapture/rebaseline.

## Presealed observations

Exactly 24 calls, once each, in ROWS order; at most32 calls authorized overall.
Each row is an absolute-path Bash --noprofile --norc -c invocation, fixed argv0
dotglob-reference. Each probe is a trusted literal, followed by builtin printf
of its status and builtin shopt -p dotglob poststate. Markers use ASCII RS.
Probe status differs from process status (the latter reflects the final marker
printf, normally zero). Stderr markers delimit each probe's exact diagnostic.
Setup uses only builtin shopt; no alias, eval, source, external command, dynamic
source interpolation, network, user data, or opaque host target. Native
expand_aliases is observed only as a shopt name; project explicitly refuses it.

Environment is replaced with LC_ALL=C LANG=C TZ=UTC NO_COLOR=1 TERM=dumb,
HOME/TMPDIR=row directory, PATH=/usr/bin:/bin; no inherited BASH_ENV, ENV,
SHELLOPTS, BASHOPTS or credentials. Stdin is closed. Source/input aggregate
<=16KiB. Deadline <=3000ms/call; combined stdout/stderr <=65536 bytes/call.
Parent creates a detached owned process group, kills only that group on deadline
or capture overflow, waits for child close and confirms group absence. No SIGSTOP.
If group absence cannot be confirmed promptly, stop; never proceed to another row.
All rows and fixture files are created with Node builtins, within a unique temp
fixture root: root +24 rowdirs +7 fixture entries =32 entries, file bytes <=64KiB.
Receipts/captures are separate artifacts, not glob-visible fixture inputs.
Record sorted recursive pre/post census (type, mode, size, file SHA256), including
new entries, for every row; retain all rows without pass/fail relabeling.

## Scope and interpretation

Flags target order/repetition, -s/-u conflict, -q/-p interaction, --, invalid
flags, operand ordering, unknown/valid partial changes, errors despite -q,
and native expand_aliases versus our explicit refusal. One baseline default
listing is retained exactly; other no-operand filtered listings also remain
native full-option output, never presented as project-supported inventory.
The final row uses tiny nested/dot/bracket/quoted/unmatched/literal controls and
same-read-unit off/on/off commands. No unbounded pattern or Cartesian sweep.
Cancellation, shared budgets, provider order, lifecycle and sink failures remain
future project checks, not native proof. Current mixed HEAD is not certified.
No product test/import, benchmark, historical evidence modification or blocked
resource/accounting investigation is part of this task.

After execution: atomic observation-only commit, then separate final design/docs
commit. Final candidate receipt is separate from readiness and written via CLI.
