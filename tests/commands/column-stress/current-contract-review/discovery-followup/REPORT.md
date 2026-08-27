# Read-only discovery and replay readiness

**Answer: legacy S38 is explicit historical audit code, not default canonical
discovery. No S38 driver migration is needed.** No build, test, package, native
cohort, or final-input replay was executed by this follow-up.

Inspected HEAD: `fdc3e20437de1278eec4299a283c48d5dd49aedd`; initial inspection
HEAD was `e8601a6d6b8a3627fdef33377d8f956ded2f39a4`. Other workers committed
during inspection. `DISCOVERY.json` records timestamps, exact file hashes and
ancestry; all inspected working files matched the recorded inspected HEAD.
Only repository/parent AGENTS apply here; no deeper instruction file applies.

## Discovery facts

- `package.json` uses `globSync('tests/**/*.test.ts')`, excluding only the named
  regex native-data directory, then invokes Node/tsx on those paths. A read-only
  enumeration found 586 files: 580 tracked and six unrelated untracked regex
  artifact tests. This is discovery, not a test result or a clean-tree claim.
- Nine current column `.test.ts` files and three alias `.test.ts` files are listed
  and hashed. There is **no discovered `canonical.test.ts`**. No discovered test
  directly references S38, the hidden-return driver, or the legacy stress driver;
  tracked source-reference inspection found only explicit audit entrypoints.
- Column's only `column-stress/*.test.ts` entry is `owned-regressions.test.ts`:
  six direct-command context/cancellation regressions, not the Shell disposal
  assertion. The actual stronger assertion is in
  `handoff-20260827/safety.mjs:147`, imported by `stress.mjs`. Neither is selected.
  `root-hidden-return-repro.mjs` is also explicit. Archived `.txt`/JSON copies do
  not become active tests because they contain source text or old path names.
- Alias original holdouts are `grep-aliases-stress/verification/holdouts.mts`,
  copied/compiled/run explicitly by `run-standalone.mjs`; they are not column S38
  and are not default `.test.ts` discovery. Alias ownership stays elsewhere.
- The frozen `3af3f628` tracked-path inventory likewise has no `canonical.test.ts`
  or alias-stress `.test.ts`; its column-stress test is the six-regression file.
  This old inventory is not evidence of current/final runtime acceptance.

Explicit legacy commands, **documented only, not executed**:

```sh
node tests/commands/column-stress/handoff-20260827/stress.mjs "$BUILT_CANDIDATE" "$NEW/legacy.json"
node tests/commands/column-stress/handoff-20260827/root-hidden-return-repro.mjs "$BUILT_CANDIDATE" "$NEW/hidden.json"
node tests/commands/grep-aliases-stress/verification/run-standalone.mjs "$FROZEN_PACK" "$NEW_ALIAS_ATTEMPT"
```

The legacy stress runner requires a `/tmp/safe-bash-column-*` candidate. Existing
explicit `current-contract-review/run.mjs` also invokes these column audits, but
hardcodes **3af3f628**, so it is not a final-input replay command.

## Separate canonical issue, proposal only

`aaa09274be38521ff071f4cc8f0022aa62816fa3` changes **AGENTS.md only**. It does not
migrate any driver. Current default
`tests/commands/column/padding-evolution/preserved-source.test.ts` still contains
**two implementation-byte-pinning tests**. This is separate from S38 and conflicts
with the new current-versus-historical discipline; no assertion was changed here.

Minimal owner proposal: after root assigns that file to its column owner, rename
it byte-for-byte in the same directory to `preserved-source.audit.ts`, retaining
`preserved-source.json` and all historical captures. Explicit historical command:
`node --import tsx --test tests/commands/column/padding-evolution/preserved-source.audit.ts`.
That preserves both audit checks and relative input bindings, while removing
exactly two version-specific checks from default discovery. Keep all behavioral
column/shell tests and strict TypeScript coverage; no skip/xfail or broad exclude.
No source semantics are waived. Any owner-requested replacement canonical contract
driver must cover registered positive/raw negative plus normal wait/error, not
reintroduce the undeclared raw post-disposal barrier. No such migration is
authorized or implemented in this follow-up; let the other padding reviewer seal.

## Final replay readiness — blocked on acceptance, not started

`f8819e9d6b6d535b0626e0aa004bb10a7bc36785` includes padding ancestor
`a809635432f18a235b8fb622a05367bedc54b315`. It is an ancestor of the inspected HEAD;
the inspected HEAD has no additional changes to `src/shell/input.ts` or
`src/commands/column/**` relative to f881. **Arch's independent final acceptance
has not been supplied for this assignment.** Root must provide/confirm that
acceptance and the exact accepted combined root SHA before authorizing execution.
Neither current HEAD nor old 3af evidence substitutes for that approval.

Propose a **new separately owned wrapper/binding configuration**, not an edit to
ee933d5d's runner or fixtures. It takes an explicit accepted commit and unique
output directory, authenticates a whole regular-file Git archive and locked tools,
and verifies f881/padding ancestry plus exact input/column blobs from the accepted
root. No live overlays or cherry-picks. Preserve full before/after membership,
source/build/load receipts, package hashes, bounded children and exact cleanup.

Authenticate `probe.mjs` against ee933d5d and SHA-256
`ca527d7a6e57d497f1c8118e64e3c416133b3b5eb558ca9f766a1dbaf64bbb08`; copy it **unchanged**,
with unchanged loader/consumer fixtures, into the new execution locations. Its
existing arguments already select candidate root, new output, and source/packed
mode. Run the same twelve assertions against freshly built source and a freshly
packed/moved package: public-root Shell, internal column file URL. Change only the
external binding/run configuration. Never reuse old raw results or infer 12/12.

Expected future reporting partitions, not newly observed results: **12 source +
12 moved**, original **39 other column recipes**, and legacy S38 literally failed
in **39/40**, with historical **37/40** unchanged. Preserve the original hidden
exit 1/HOLD separately. Keep original 84 recipe-associated/4 supplemental variants
distinguishable; alias original holdout identities/counts belong to its verifier.
No acceptance-assertion edits, blanket skips, default integration or global green.

All 80 original manifest payload files and the manifest itself remain unchanged.
Adding this authorized child directory intentionally extends the parent directory's
membership: its old append-proof `verify.mjs` should be audited at **ee933d5d's
immutable tree**, not claimed to pass over the expanded live tree. It was not run
or weakened. Only these new discovery documents are committed; inspection
processes closed, no background job or temporary candidate was created.
