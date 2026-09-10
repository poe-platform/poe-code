# Integration gate after Proxy keys and string argument repairs

## Candidate and build

Runtime commit `d40849585` includes the internal Proxy numeric-key repair and
the string search, repeat, character, range, normalization, padding, ignored
argument and concat Symbol repairs. The worktree also contains unrelated
user-owned changes and tests; this is not a clean-tree qualification.

`npm run build:workspaces -- --workspace=@poe-code/safe-js` passed (4dde47):
23 workspace builds and five fresh-process built ESM import checks. Build
membership and dependency closure came from the maintained workspace runner.

## Full-package run

Started session `45190` with:

```sh
npm test --workspace=@poe-code/safe-js -- --reporter=json --outputFile=/tmp/safejs-post-string-gate.lUy37m/results.json
```

Keep runtime files unchanged until the run terminates. Resume the same live
session; JSON-reporter silence does not establish completion or a hang. The
previous terminal full-package result remains 27,690 passed, 14 failed and
47 skipped until the new report can be inspected. No new full-suite pass is
claimed from focused checks or a successful build.

All 100 filesystem type contracts passed before unit-test execution (2bd8e0).
Runtime sources remain unchanged. A concurrent read-only upstream selection
passed all 131 fixtures; see
[the qualification record](safejs-test262-string-repair-qualification.md).

No push, issue closure or release was performed. The release hold remains active.

## Terminal result

The run terminated with exit code 1 and wrote its JSON report (fc0faf).
Inspection reports 28,025 passed, 14 failed and 47 skipped across 1,234 files
(d598f1, a6095f). All failures are the same twelve ISO/Temporal month-formatting
cases and two host Promise own-property admission cases. No new string-fix
failure is present. This remains a failing full-package gate, not a clean pass.

Proxy locale-list membership and context-free localeCompare candidates were
kept outside main during this run. They require separate main-worktree checks
after transfer and are not covered by this terminal result.
