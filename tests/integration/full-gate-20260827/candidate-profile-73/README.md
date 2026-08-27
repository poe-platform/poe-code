# Explicit candidate profile and73-name smoke

2026-08-27. Author source `522e8e27`; independent review pending. This is a draft
profile generator, not selection, acceptance or execution of a whole-gate candidate.

## API and bindings

```sh
node tests/integration/full-gate-20260827/candidate-profile-73/prepare.mjs --candidate FULL_40_CHARACTER_COMMIT --output NEW_EXTERNAL_DIRECTORY
```

The source commit must be explicit: HEAD, short IDs and nonexistent objects
reject. All product/config/test identities come from that commit's Git blobs,
not dirty/untracked overlays. The output must be new and physically outside the
live repository, including through symlinked parent paths. Existing output is
never overwritten. `verifyPrepared(directory, candidate)` rechecks exact profile
membership/hashes, candidate/tree, Git input membership/content, native identities,
concurrency2, package metadata and the authored smoke templates.

Output comprises `CANDIDATE.json`, `policy.json`, `cleanup-expected.json`,
`public.mjs`, `consumer.mts.fixture` and `RECEIPT.json`. Approval remains
`PENDING_ROOT_COHORT_AND_INDEPENDENT_HARNESS_REVIEW`; launched remains false.
Neither generator nor verifier installs or launches anything. No product source
or historical receipt is modified.

The cleanup envelope binds every committed `src/` input, package/lock, inherited
build configurations and exact cleanup test/probe/binding inputs. It is not a
fixed220 or244 allowlist. Policy scope binds every Git entry; canonical discovery
retains the original `.test.ts` selection and its existing native-data exclusion.
The native base comes from external harness `6699804a`, not falsely from product
8670 (which predates that policy file). All49 expected bytes remain unchanged;
rg gets the explicit `RG_NATIVE_BIN` recovered origin. When expr/du tests exist,
their two additional author-oracle requirements are disclosed separately, not
silently called part of the previously accepted49 or proof of tool acceptance.

## Historical calibration, not a new launch candidate

`CALIBRATION_RECEIPT.json` and `CALIBRATION_CLEANUP.json` bind exact committed
`c355751f36ca3fdbab8f888eaab30203c1bcd343`, the earlier readiness observation.
There are600 canonical paths and244 cleanup inputs. The cleanup envelope matches
the prior readiness envelope exactly; no old220 manifest was reused. This source
correctly reports its original eleven unknown inventory inputs: it predates the
classification patch. The new generator is not allowed to hide that fact by
reading today's inventory. Native counts are49 base plus2 disclosed extensions.

The receipt preserves hashes for all generated files. Large `policy.json` is
reproducible from the exact Git commit rather than copied into this evidence;
the calibration directory remains outside the repository. Repeating preparation
with that commit and new output reproduces those file hashes. Current source
selection requires a separate root cohort decision, including any committed but
still pending source. The old `combined-8670ebe8` launch driver remains8670-bound;
this generator does not silently rewrite its checks or activate a successor.

## Checks and smoke execution

`controls-v1.tap`:19/19 before additional extension/approval/source-tree guards.
`controls-v2.tap`:23/23 after those guards, zero skips. These are successive
versions, not42 independent cases. Tests inject missing/extra/changed/symlink
entries, rehashed wrong cleanup/source/policy/package inputs, native hash or
extension changes, concurrency changes and false approval. Capture/HEAD/root
alias refusals remain. Control temp directories are removed.

The smoke template explicitly lists73 names (not an implementation-derived
expected set), retains four old workflows and adds actual alias and column
pipelines. Optional curl/SafeJS remain opt-in; expr/du are not defaults. Root and
public subpath type fixtures cover alias options, column limits and aggregate
forwarding. Actual packed execution is preserved in
`../consumer-inventory-73/CAPTURES.json`, attempt04:73 names,27 imports,6 workflows
and strict public types pass with the exact c355 package. This is separate from
profile generation and not a whole-product or service claim.

```sh
node --test --test-reporter=tap tests/integration/full-gate-20260827/candidate-profile-73/controls.test.mjs
```

No whole suite, external service, private engine, new dependency or product
feature is part of this change. Matching cleanup env vars must be supplied only
after an actual successor candidate is chosen and the final profile is bound.
