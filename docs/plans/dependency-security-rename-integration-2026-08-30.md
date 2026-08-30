# Dependency security: renamed-workspace integration preparation

## Status and scope

**Preparation only; awaiting root GO for bounded runtime validation.** Nash owns
the major CPU window. No npm, lock regeneration, installation, build, test,
TypeScript, target-runtime execution, audit, or full-tree hashing runs here.
Only Git metadata, scoped file reads, JSON parsing/merging, patching, and small
capture hashes are used. No publication is approved or performed.

The fresh isolated clone is `poe-code-dependency-rename-integration-20260830`.
Clone and successful `git pull --ff-only origin main` precede all edits. Base:
`0b10f2f4d4ccda5577b87ee72bdb85a2fa992558`.

The prior capsule remains immutable:
`poe-code-dependency-integration-prep-20260830/out/dependency-security-main-prep/final/manifest.json`,
SHA-256 `e5c0a2cf789a323fa19c766c32149a40efc41ed3ca796de5e31a54a140dc6583`.
Its base is `49eea61131a83e2713c5b7ca3b198631bef7be4c`. Its manifest and the
four scoped configuration/test preimages and postimages are hash-verified;
no prior capsule, checkout, artifact, or generated font is modified.

The new publication scope is exactly five paths:

- `package.json`
- `package-lock.json`
- `packages/poe-agent/package.json`
- `tests/integration/standalone-package-metadata.test.ts`
- This unique author plan, absent from the new base.

## Minimal three-way merge

Parse the old capsule's preimage/postimage JSON and derive only changed fields.
Apply each field to the fresh upstream value only when it still equals the old
preimage or already equals the intended postimage. Preserve every other field.
There are no conflicts. Added lock keys follow their prior npm-generated positions
without reordering existing upstream keys. No old whole lock replaces current main.

The candidate retains shell-quote `^1.9.0` in both owning manifests and root
`bundleDependencies: ["gray-matter"]`. The locked, actually used YAML 3 parser
remains 3.15.1; there is no parser rewrite or new unused direct dependency.
Exactly 25 lock package records differ from the new base. The existing overrides,
root engines, lock headers, and three held brace-expansion 5.0.6 paths are unchanged.
No engine policy, unsupported T3 upgrade, fork, or additional behavior is introduced.

Upstream's seven changed lock keys are preserved, including its root metadata,
`packages/agent-harness`, `packages/toolcraft-codemode`, removal of
`packages/safejs` and `node_modules/@poe-code/safejs`, and addition of
`packages/safe-js` and `node_modules/@poe-code/safe-js`. The latter link resolves
to `packages/safe-js`, whose safe-fs dependency remains intact. The root's renamed
development dependency, canonical and legacy exports, both bin names, browser
conditions, and packaged dist paths remain exactly as upstream supplies them.

The metadata test is a clean three-way merge, adding only the existing semver
import and the three inherited security assertions. All upstream imports and
assertions remain, including the new canonical/legacy SafeJS route comparison
and renamed package paths. No validator assertion is deleted or weakened.

## Evidence that remains valid historically

The old capsule remains exact evidence for its declared 49ee base, not this base:

- Metadata RED: 3 failed and 14 passed, exit 1; unchanged assertions are retained.
- Scoped controls: 254 passed across eight files on both Node 22 and exact Node 18,
  exit 0, including all 37 shell/policy tests and the ordinary parser checks.
- Node 22 lifecycle build/pack passed, and all 17 package rules passed without skips.
- Developer-lock audit removed 28 IDs, held 3, and added none; both audits exited 1.
- Actual installed main/agent imports loaded shell-quote 1.10.0 and bundled
  js-yaml 3.15.1 on both runtimes. Unrelated root YAML 3.14.2 remained. This was
  scoped physical-consumer evidence, not an all-graph security result.
- Paired Node 18 builds and complete package checks both failed for
  `node:sqlite: invalid-external`. Candidate reused 66/68 workspace tasks;
  baseline reused none. This did not establish a cold candidate Node 18 build.

The older full-suite evidence still has 99 shared assertion failures and raw
exits 130, with shutdown uncertainty and an additional candidate fakes-worker
nontermination report. No exact unhandled-error count is established. None of
these failures is waived, and the minimum-Node-22 decision remains unanswered.

The three held IDs remain GHSA-3jxr-9vmj-r5cp, GHSA-mh99-v99m-4gvg and
GHSA-rgw5-rvv9-x895. Current parsed lock comparisons preserve their three paths,
but no fresh current-base audit or physical installation has been performed.
The bounded 28-ID remediation remains pending and unpublished.

## Checks needing renewal after root GO

1. Regenerate the current lock and inspect every changed record before isolated
   installation. Keep current upstream workspace/link/header changes. Any unrelated
   npm normalization must be recorded and assessed against fresh preimages.
2. Capture fresh baseline/candidate advisory IDs, ranges, and affected lock paths.
   Confirm actual installed versions rather than projecting the historical audit.
3. Continue the unchanged metadata and full scoped shell/frontmatter/packaging
   controls. Retain upstream's added canonical-route test; do not force historical
   test counts onto a changed upstream test file.
4. Build/package the renamed workspace and run current package-lint. Verify actual
   tarball files, canonical and legacy SafeJS exports/bins, and safe-fs/browser
   conditions against current upstream. Old 49ee bundle bytes cannot prove this.
5. Install the new artifact into the unchanged benign seeded consumer. Recheck
   both owning shell floors, actual main/agent module loading and bundled YAML,
   plus current canonical/legacy routes. Do not reuse the old artifact as proof.
6. Run configured and edited-test types, scoped lint/format, and only the finite
   Node 18 checks authorized by root. Do not rerun the known failing full Node 18
   suite blindly or infer current package/build equivalence from old line numbers.

Use own isolated HOME/cache and an external temporary directory, with
`SKIP_SYNC_SKILLS=1` and TERM unset. No live services, credentials, LLMs, probes,
or original audit payloads are needed. Publisher owns normal full gates and all
Git publication; a new root GO is required before this bounded runtime phase.

## Prepared handoff

Exact current-base preimages, candidate postimages, parsed field operations,
upstream-preservation checks, the test merge, and inherited-evidence qualifications
are captured in `out/dependency-security-rename-prep/prepared/manifest.json`.
The four existing-file preimages are checked against the pulled commit, and this
plan's absent-at-base preimage is explicit. This is a prepared metadata capsule,
not a runtime-validated or publication-approved candidate. Root can pass it to
Sartre for independent review; direct agent messaging is unavailable.

Only the five owned publication paths change. No Nash source, README, ledger,
workflow, home skill, original checkout, or other worker's file is written.
