# Mandatory whole-gate preflight repair — 2026-08-27

This is a **harness correction**, not a product fix, fixture migration, or release
acceptance. The original b494 run and its 812 authenticated captures remain
byte-identical. `HANDOFF.md` answers the five root questions; `TYPE_DIAGNOSTICS.md`
lists every cold/post-build diagnostic. No new whole suite ran during this task.

## Entry point and refusal

```sh
npm run verify:release:whole -- --handoff EXACT_COMMIT --preflight-only
```

This command checks only prerequisites and source bindings. Exit 78 means refused
before suite execution; there are no passing product tests behind that exit. The
separate `--execute NEW_OUTPUT` route has the **same mandatory check before any
archive, build, private-engine copy, or suite**, and checks again immediately
before canonical execution. Do not use the old frozen diagnostic `run.mjs` as a
release entry point: it remains unchanged for reproducibility, not endorsed.

Only the original exact b494 candidate has a reviewed census in this repair.
It is deliberately **rejected** because its historical guards are stale and its
canonical direct-curl fixture writes tracked history. Unknown/new commits reject
before work; there is no `--force`, automatic repinning, exclusion list, or
uncommitted-source fallback. A subsequent root-approved candidate requires a
separately reviewed policy/census update after the owner repairs are sealed.
Root has relayed independent acceptance of Arch's writer repair `5f7fe5d7`;
the next approved candidate must contain it. It is not silently substituted into
b494. The separate 99 stale-pin classifications remain with Plato.

## Checks

- Exact candidate SHA; 550 canonical paths; 766 source/test/config Git blob/mode
  bindings. A new canonical test or a missing bound input fails closed. Source
  content comes from the requested commit, not an assumed moving HEAD.
- Dirty tracked working/index inputs reject, including evidence-only changes.
  Untracked foreign preparation is not consumed, erased, or blanket-staged.
- Twenty original historical source/helper comparisons run **before** tests.
  Their mismatches are distinct from runtime artifact mutation. The old writer
  is explicitly blocked; changing its hash does not automatically clear the block.
  This is a reviewed known-writer control, not a universal static proof that
  arbitrary future test code cannot write. Snapshot hashes still check every phase.
- Forty-nine pinned native assets cover the existing metadata/table, archive,
  byte and system profiles plus the seven omitted executables and explicit stream/
  tree opt-ins. Missing, changed, non-executable or unreviewed-link inputs reject
  before work. No downloads/installations occur. Three new date/sleep/printenv pins
  record observed GNU9.7 Darwin binary hashes and versions, not supply-chain proof.
- Native copies land at the exact fixture-relative paths; byte/stream/table/tree
  environment variables point to their declared profiles. The formerly optional
  live profiles are mandatory for this successor scope. `TREE_NATIVE_BIN` must
  explicitly identify the author's exact pinned binary, not any PATH `tree`.
  Copies are rehashed and checked again before the suite; no fallback to a nearby
  GNU/BSD executable or missing-oracle skip counts as prerequisite satisfaction.
- The successor includes the repaired explicit current-consumer runner as a
  separate recorded phase, so the two canonical `.test.mts` runtimes are not
  confused with npm's `.test.ts` discovery. Packed consumer types use
  `skipLibCheck: false`. Actual SafeJS still requires isolated regular-file copies;
  no private checkout or upstream patch changes are introduced.

The policy is a trusted reviewed harness input, not adversarial-host-JavaScript
sandboxing. Its finite source scope and known-writer refusals are explicit;
updating it requires source review, not merely relabeling failures. Native
availability does not imply semantic parity or correct server behavior.

## Bounded verification

`node --test tests/integration/full-gate-20260827/preflight-repair/preflight.test.mjs`
runs isolated miniature Git repositories and task-owned temporary files, not the
product suite. Controls cover a legitimate admission, missing/changed/nonexecuting
native binaries, opt-in absence, index/worktree dirtiness, faithful untracked-file
preservation, stale source binding, known/changed writer, census/source/profile
drift, staging escape/change/deletion, and the real root entry point rejecting
before output creation. Two deliberately broken guard mutants demonstrably reach
a forbidden **sentinel** callback; this is mutant detection, not suite execution.

One additional native-materialization control copies and executes only `--version`
for all seven originally omitted GNU tools at their exact fixture paths. It does
not bypass the candidate rejection or claim seven product features pass.

`evidence/` contains the bounded TAP, actual preflight refusal and identity manifest.
The original first 21-control result is retained beside the expanded final result.
No source tests, native expectations, private repository or historical full-run
files were modified. No full build/typecheck was repeated while other owners work.
