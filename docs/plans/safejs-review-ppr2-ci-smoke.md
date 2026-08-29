# Independent PPR002 CI smoke review

## Intake and scope

Independent delegated review preparation on August 29, 2026. Pascal owns the
minimal author repair in a separate clone. No author candidate has been supplied
yet; this worker does not author the fix or read racing author files.

The new clone is
`/Users/kjopek/Workspace/poe-code-safejs-ppr2-ci-smoke-review`.
Clone and a successful `git pull --ff-only` pin
`b06e79ab841765f06d0a577230f10db28f98c457`. Applicable workspace/repository
instructions are read. O10 and O12 captures are untouched.

The publisher's supplied result reports Release `33255231803` failed at
`npm run smoke`, Pages `33255231814` passed, and publishing did not proceed.
This is recorded evidence, not a new npm registry query. The three explicit
publisher receipts are copied with hashes into the independent evidence folder.

## Bounded review procedure

1. Preserve the unchanged smoke source and genuine historical v6 fixture bytes.
2. Install locked dependencies with clone-local cache and setup-only
   `SKIP_SYNC_SKILLS=1`; use `env -u TERM` for setup/build/smoke.
3. Build the actual unmodified standard public artifact and run the unchanged
   full packed-install CI smoke. Isolate npm prefix, HOME, caches, and temporary
   directories inside this clone so global install/cleanup cannot affect the
   user's installed CLI or live home. Do not disable lifecycle hooks or change
   the smoke's commands, assertions, or timeouts.
4. Verify the failing assertion concerns the snapshot freshly produced by
   `dump(referenceResult)`, not any historical v6 capture. Preserve initial and
   replay values `[14,1,2e+100]`, one host read, and identical public entrypoints.
5. Once root supplies Pascal's frozen manifest, verify its exact bytes/preimages
   and apply only its reviewed smoke/doc delta. No runtime fix, version rollback,
   workflow unit test, historical marker rewrite, or oracle weakening is allowed.
6. Require the full unchanged packed-install smoke to pass after that delta,
   then run adjacent history/compatibility and configured/static gates and seal
   the reviewed author files plus this independent report for root's decision.

The smoke's provider/MCP paths use its existing finite mocks and dry runs, not
real LLM requests. Workflow prompt preview remains preview, not a security scan.
No original audit payload, security probe, README edit, live skill sync, commit,
push, other-clone write, private instrumentation, or CI bypass is authorized.

## Current finding

`scripts/smoke-test.ts` creates a fresh run, immediately dumps that result, and
replays it through the public core entry. Its line-131 combined assertion still
requires `jobs-v6`; current `EXECUTION_SEMANTICS` is `jobs-v7`. Restore separately
accepts genuine v6 snapshots. The exact published CI diagnostic records correct
initial/replayed values and read count, with the fresh v7 marker as the mismatch.

Preparation is in progress. No author repair or publisher-resume approval is
asserted before the frozen candidate and full post-repair smoke verification.

The independent standard root build passes. A separate observation through the
unmodified public `poe-code/safejs` and `poe-code/safejs/core` exports reproduces
both `[14,1,2e+100]` results, exactly one host read, identical `run` entrypoints,
and a fresh `jobs-v7` snapshot. Its source is extracted from the actual smoke
source, not replaced by a hand-built expected result. This diagnostic is not
misrepresented as packed-install smoke success.

The first full packed-smoke attempt stopped in `npm pack` prepack before any
smoke assertion: tsx reported `EADDRINUSE` on its IPC pipe under the long
clone-local temporary path. That failure is retained. The unchanged command is
retried with only a shorter clone-local `TMPDIR`; no hook, assertion, timeout,
runtime, or version change is made. Actual smoke runs unset `SKIP_SYNC_SKILLS`,
keep lifecycle scripts enabled, and verify the clone-owned npm global prefix.

The unmodified baseline smoke source also fails configured Prettier; the owned
report passes. This baseline formatting failure is retained for the candidate's
paired review rather than repaired by the independent worker.

## Independent packed RED

With the shorter clone-local temporary directory, the actual unchanged
`npm run smoke` packs, installs, and runs successfully through all 19 CLI
commands. The SDK import smoke then exits one at the original combined
reference/replay assertion requiring `jobs-v6`, matching the published CI
failure. The later credentials/config import checks are not reached because
the existing script uses short-circuit conjunction; they are not claimed green.

The script source and all preserved runtime/v6 fixture hashes remain unchanged.
No global install, cleanup, temporary file, cache, or home write escapes this
clone's explicitly selected directories. No lifecycle hook or smoke command
was disabled, and no timeout or assertion was relaxed.

The baseline capsule is
`out/safejs-ppr2-ci-smoke-independent/baseline-red/manifest.json`.
It preserves the original CI receipts, exact smoke/runtime/fixture preimages,
standard-build output, independent public diagnostic, both full-smoke attempt
receipts, and the baseline formatting failure. Final author intake and review
remain pending root's exact frozen manifest; publisher must not resume on this
preparation result alone.

## Final independent decision: READY for the bounded repair

On August 29, 2026, the frozen Pascal candidate passes independent review.
The preceding preparation sections describe the preserved pre-repair state;
this section supersedes their pending status. This is readiness for root's
three-file smoke-contract intake, not approval of a remote release or a new
all-stack runtime certification. Release `33255231803` remains recorded failed.
Root/publisher must run the actual publication gates and monitor the new release.

The author manifest is verified at
`ffcfa9b36e13cac7d21de6669cb5d100750d272dc0a17c673ef77e0abeb923f2`.
All 60 listed immutable members match their sizes and hashes. The exact main
script preimage matches before staging; both publication documents are absent
at main `b06e79ab841765f06d0a577230f10db28f98c457`. Only Pascal's exact two
postimages are applied, plus this independently owned report.

### Exact semantic and native proof

Independent TypeScript AST comparison finds one changed decoded string in the
outer script. Parsing that embedded SDK assertion again finds exactly one
changed literal: `jobs-v6` to `jobs-v7`. All other semantic nodes, assertions,
operators, command order, public imports, and timeouts match. Formatting the
one-literal-only baseline with the configured Prettier produces Pascal's exact
postimage, SHA-256
`59f263851f8745cc64fda503c634a4310203efcbd94d266188f2e492ec79cf32`.
The `+36/-36` diff is therefore one semantic assertion repair plus authorized
formatting, not hidden runtime or assertion changes. Preliminary token-tree
comparison included trailing-comma punctuation and raw SourceFile text; those
comparison-tool false mismatches are recorded, not runtime failures.

The assertion observes a fresh `run`, immediate `dump`, and public-core replay;
it does not load or relabel historical evidence. Native execution of that exact
reference source returns `[14,1,2e+100]` with one host read. The unchanged public
artifact independently returns the same initial/replay values, one host read,
identical public `run` entrypoints, and `jobs-v7`. Genuine v6 acceptance and v6
checkpoint emission remain a separate compatibility contract.

### Actual packed smoke and applicable gates

The exact final script passes the full `npm run smoke`: all 19 CLI checks, the
complete SDK import smoke, and the later credentials/config import smokes,
22 total, exit zero. The normal `npm pack` prepack build, global install,
temporary SDK install, public imports, original 30-second command timeouts,
and cleanup all run unchanged. Cleanup leaves no new smoke directories or
global package. No runtime, generated bundle, or private export is instrumented.

The independently captured actual smoke tarball is byte-identical to all three
verified author RED/literal-GREEN/final-GREEN tarballs: 15,855,016 bytes, SHA-256
`f6b3de012d70d5b32ff2f9137e00872de892802f23dc558c98093541236e0210`.
Capture only observes/copies the complete archive in the owned temporary
directory before normal cleanup; it changes no tested code. The independent
RED did not retain its own tarball, and no such identity claim is made.

Fresh independent gates pass:

- 64 unchanged history/recovery controls across three test files, including
  genuine working v6 continuation/emission and historically failing raw-v6
  TypeError expectations; none are skipped, relabelled, or weakened.
- 126 unchanged adjacent controls across four files: reference evaluation,
  external checkpoints/validation, and agent-harness results.
- Configured root types and explicit strict smoke-script types.
- Root ESLint, explicit smoke ESLint, and all 17 package lint rules.
- Configured Prettier for all three publication files and strict whitespace.
- Standard root build, already independently run before RED, plus the actual
  final smoke's normal prepack build. No force/timeout bypass is introduced.

This bounded review does not rerun the full root unit suite or turn the earlier
expanded legacy type qualification into a green claim. No production or test
runtime behavior changes here. All 33 protected main paths, including the
three genuine historical fixture files, runtime/G01 source, workflow, lockfile,
and existing test assertions, retain their exact bytes.

The independent smoke uses `TERM` and `SKIP_SYNC_SKILLS` unset, with npm lifecycle
scripts enabled. Pascal's recorded smoke environment includes the sync skip
flag; the independent gate does not inherit it. Setup alone uses that flag.
HOME, npm prefix/cache, and short `TMPDIR` remain clone-owned. The original
temporary-path failure and baseline formatter RED remain preserved in the
unchanged baseline capsule; neither is erased or counted as a runtime pass.

### Exact publication ownership and evidence

The final handoff is
`out/safejs-ppr2-ci-smoke-independent/handoff/manifest.json` in this review clone.
Its publication list is exactly:

1. `scripts/smoke-test.ts`: Pascal postimage; exact main preimage included.
2. `docs/plans/safejs-fix-ppr-002-smoke-contract.md`: Pascal report; main absent.
3. `docs/plans/safejs-review-ppr2-ci-smoke.md`: independent report; main absent.

The manifest separates these three paths from validation-only logs, tarball,
protected history, author intake, and baseline evidence. No runtime, fixture,
workflow, package config, README, executable QA file, or ignore entry is added
to publication. No original audit payload is read; no other clone is written;
no live skill sync, commit, push, release, or registry publication is performed.
