# Independent compiler-policy fixture review

## Verdict

**Accept the bounded test-only migration
`91d56dbececa0cbc273c7680c60cf9a054470414`.** It changes only the maintained
`tests/plugins/qualified-current-release-native-data/controls.test.ts`, not
compiler configuration, package scripts, product code or historical captures.
The expectation comes from authenticated old configuration plus the exact
approved native-data subtree and five named flattened captures, not from a
comparison of current config with itself.

Executed in a fresh frozen copy:

- Revised fixture **8/8**, zero skipped/cancelled/TODO tests.
- Original unchanged fixture **4/5**, its obsolete configuration assertion still
  failing against the approved config. No original capture/expectation rewritten.
- **Six independent mutations detected**: extra current-source exclusion,
  lookalike capture path, sixth flattened capture, weakened strict-null option,
  self-comparison assertion, and a removed required maintained consumer route.
- Strict scoped TypeScript passes with `skipLibCheck:false`; no diagnostic
  suppression or new broad exclusion is introduced.
- Four unaffected original test bodies are byte-identical. All five flattened
  capture payloads plus three provenance/replay files authenticate against Git.

This is compiler-policy **fixture** acceptance, not a global typecheck, current
full-suite pass, provider workflow result or whole-gate rescore.

## Retained extra-check failure and native provenance

The independent runner reports **13/14 checks**, not 14/14. Its additional
attempt to authenticate all72 historical native-data entries with `git show`
failed on the first path: those payload/cache files were not Git-tracked at the
reviewed revision. That check's assumption was wrong; the maintained test asserts
the authenticated classification manifest, not that each underlying historical
raw/cache file is a committed source unit. Its raw error remains in `attempt-1`.
It is not reclassified as a passing executed check or hidden from the denominator.

The separate `NATIVE-INVENTORY.json` establishes the exact scope:

- **0/72** payload/cache paths tracked in Git91d56dbe; all72 untracked there.
- **72/72** currently present regular files match the recorded manifest hashes,
  checked read-only twice within the recorded interval; none missing/mismatched.
- That is a current filesystem supplement, **not** invented historical Git
  provenance, an execution result, or a reason to expand exclusions.

The five flattened contract captures are different: their bytes and provenance
are committed and independently hash-authenticated. The source-data distinction
and approved exact exclusions remain intact. No raw/cache file was executed or
written by this review.

## Checks and mutation meaning

The complete unchanged8-test fixture runs its actual compiler and npm-discovery
controls: six eligible neighbors still produce the exact TS2304 diagnostics;
five current-contract paths plus three eligible neighbors produce exact TS2322
errors when corrupted; npm discovers/exercises five eligible tests and rejects
the two deliberately unfiltered native-data test payloads in its negative run.
These use generated scoped inputs to verify path coverage, not a claim to have
compiled every real current contract/consumer against all dependencies.

The copied self-comparison mutant executes all eight tests and fails exactly the
mutation guard (**7 pass/1 fail**). The other five mutations select the relevant
maintained policy/route assertion and require its actual failure; seven other
test names are deliberately not selected in those controls and are not counted
as passes. Full positive8/8 remains a separate unfiltered run. Mandatory route
names, exact file arrays and route kind are checked; no brittle total group
count or all-historical exclusion is introduced.

The test-only commit's package.json and tsconfig.json are byte-identical to its
parent. Expected config uses the old `before-02.json` hash
`cb0e439212ffb280f513b6104fa69d99399afc6813cd51fe250df942542f86c1`, and the
five-capture classification hash remains
`70fcd5c2b8d8baec26c2c69cc3fb9110de75366757bf36416b52d7838f4b961f`.

## Boundaries and cleanup

Installed Node22.22.2 executable SHA256
`5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011` runs the
frozen fixture. 314 authenticated development-tool files are copied into the
owned source copy. The unchanged helper creates temporary links only to those
owned tool files, not private/live product sources. npm uses the installed
Node22 toolchain and does not install packages.

The frozen source/tool file and directory inventory matches before/after,
including **new-entry detection**. The read-only native supplement checks its
72 listed files only; it does not claim a census of every ignored native path.
The final evidence seal rejects added files/directories as well as changed or
missing captures. All child commands closed without timeout/spawn failure; owned
scratch was removed. No private checkout, compiler config, product source, other
worker staging or existing historical evidence was modified.

The author's separate post-phase guard-scope report is not independently
re-certified here; its stated lack of an append census is not replaced by the
more limited source-copy inventory check in this review.

```sh
node tests/integration/config-policy-fixture-independent-20260827/run.mjs /tmp/UNIQUE-config-review
node tests/integration/config-policy-fixture-independent-20260827/native-inventory.mjs /tmp/UNIQUE-native-inventory.json
node tests/integration/config-policy-fixture-independent-20260827/verify.mjs
```

The first command preserves exit1 for its inapplicable all72-Git extra check.
The static verifier authenticates the recorded classifications/results without
turning that failure or the original4/5 into a pass.

The first seal-check invocation hit its default child-output buffer limit while
reading the large authenticated `before-02.json` Git blob (`ENOBUFS`). The verifier
now uses an explicit bounded32MiB buffer, matching the capture runner. This was
a verifier setup issue, not a fixture/compiler failure; no capture bytes changed.
