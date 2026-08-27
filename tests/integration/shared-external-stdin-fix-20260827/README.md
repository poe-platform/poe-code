# External stdin return: author fix handoff

## Candidate for Arch, not independent acceptance

Review **`f8819e9d6b6d535b0626e0aa004bb10a7bc36785`**. Source changes are
`3af3f628` followed by `f8819e9d`; both touch only `src/shell/input.ts` and
`tests/shell/input-return-cleanup.test.ts`. No new API or other production scope
was used. Do **not** accept the intermediate `3af3f628` alone: the original
diagnostic replay caught a primary-read preservation regression, retained in
`attempt-1` and repaired in the second commit with an additional test.

Frozen author results, not independent certification:

| Cohort | Before | Candidate |
| --- | --- | --- |
| Same 22 new regression tests | 7 pass / 15 fail | **22/22 pass** |
| Unchanged five-file I/O/lifecycle scope | **63/63** | **63/63** |
| Original 34-row diagnostic probe, unchanged | 34 observations reproduced, including nine known defects | 25 original observations reproduced; exactly the nine old error-loss characterizations no longer match |
| Original column external-return barrier reproduction | exit 1 / HOLD | exit 1 / HOLD |
| Fresh production build | pass | pass |
| Strict scoped regression typing | pass | pass |

Zero skips, cancellations or TODOs in the 22/63 test cohorts. The original
diagnostic probe is not rewritten: its candidate run deliberately remains exit 1
with nine `observationVerified:false` rows because it asserts the old silent
success. The new tests independently assert the desired rejection identity.
Neither those nine characterization mismatches nor the retained column HOLD are
presented as passing original tests.

## Source behavior

`src/shell/input.ts:66` keeps the original shared return promise rejected and
attaches a separate rejection observer. The existing non-pending-read path awaits
that original promise. Repeated owning close shares completion and calls return
once. Borrowed views still expose no close authority; EOF remains unchanged.

The intermediate patch exposed a secondary failure after a source read error
which Shell had already reported through its existing status/diagnostic path.
`f8819e9d` records a non-aborted read failure in the cursor and prevents the later
return error from replacing it, matching the contract helper's primary-failure
handling. This is not blanket suppression: normal/early/unread/nonzero-result
close failures still surface, including `undefined` and `null`.

Caller abort remains exact, selected execution rejection retains precedence,
and abandoned raw return rejection is observed. No new wait is introduced for
opaque pending reads/generators or raw return after disposal. Registered cleanup
barriers are unchanged. The original column HOLD demonstrates that the stronger,
unregistered external-return retirement requirement has **not** been implemented.

The new regressions cover six unread identity/style rows; six actual ordinary
grep/egrep/fgrep early-stop rows; nonzero status; return-once/repeated close; EOF;
selected execution failure; primary reported read failure; caller abort and late
return rejection; disposal; pending structural reads; pending async-generator
return; and sequential cursor use with exact output bytes. Run under strict
unhandled-rejection handling.

## Frozen provenance and preserved failure

`attempt-2/RESULT.json` records exact before/after revisions and commands. The
before revision is the committed parent of `3af3f628`; its input source is
byte-identical to diagnostic baseline `eaed12f8`. The five unchanged test files
are also verified byte-identical to `eaed12f8`. The before profile receives only
the **test** file from the candidate; it does not receive fixed production source.
The parent includes separately committed column work, shown explicitly in
`HISTORICAL-TO-PARENT.diff.txt`; it is not silently described as the old full tree.

The old `28f13113` evidence, 34 observations/nine defects and 63 unchanged tests,
is not modified. `attempt-1` preserves the initial 21-test source candidate and
its failed old-cohort guard: the nine expected behavior changes **plus an unwanted
primary-read change**. Its exact runner is retained as `run.mjs.txt`. The final
22-test run requires the changed old-case names to equal exactly the original
nine defective names; the primary-read control must again match.

Each profile is a fresh regular-file Git archive and fresh build, with 314
authenticated tool files. Installed Darwin arm64 Node24.11.1 is bound to
`/Users/kjopek/.nvm/versions/node/v24.11.1/bin/node`, SHA256
`4255a388254ca4319e2f95f1da375d5deaddf25baf9c7c85070b67f9543b15d0`.
Candidate file/mode/directory inventories match before/after, including detection
of **new entries**. Children are bounded, raw outputs retained, and owned scratch
removed. No live source overlay, private checkout access, installation, full gate
or global-typecheck claim. Foreign changes are untouched.

```sh
node tests/integration/shared-external-stdin-fix-20260827/run.mjs /tmp/UNIQUE-stdin-fix-review
node tests/integration/shared-external-stdin-fix-20260827/verify.mjs
```

Arch should independently review the source and hidden/direct/Shell/alias/column
holdouts against the final candidate. Author results do not close that requirement.
