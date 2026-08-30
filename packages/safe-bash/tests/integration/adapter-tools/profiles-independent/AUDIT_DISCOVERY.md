# Provenance audit applicability

The root `package.json` at 3bf discovers `tests/**/*.test.ts`, excluding only the
explicit native-data subtree. It does not discover every `.mjs` auditor. This
review does not conflate one-shot sealing scripts, directly invoked `.test.mjs`
audits and npm-discovered canonical `.test.ts` tests.

Read-only searches covered tracked test entrypoints, references to the live
matrix/fixture paths, original hashes, and static relative helper imports with
adjacent explicitly referenced JSON. This is inspection, **not proof that every
TypeScript fixture or every dynamic file dependency was checked**.

## Existing bounded auditor executed

`tests/fs/s3/rmdir-independent/audit.test.mjs` passes **7/7** in the complete third
isolated copy. It authenticates archived matrix inputs and emitted closure,
preserves the original 78/79 failure, and verifies its historical original-artifact
seal. It does not compare the current canonical matrix hash to the old matrix.
No old evidence hash was updated. Its first incomplete-copy failure is retained.

## Stale one-shot assumption reproduced

`tests/integration/adapter-tools/atomic-webdav-profile-independent/audit.mjs` is
**not** an npm-discovered `.test.ts` test. It intentionally refuses to overwrite
an existing seal at line 13. In a complete isolated preseal copy, its line-52
`git diff --exit-code` assertion additionally rejects the approved live matrix
and fixture migration. The exact old-vs-target diff contains only those two files.
All other named originals, the old command/assertion body and old artifact seals
are intact. The source/root configuration is not the cause of this failure.

Minimal read-only reproduction of the stale equality assumption:

```sh
git diff --exit-code 68059389bf95e03caeae6479837187add3d07814 3bf672f722da2bdf1591ed112290b702987bf63a -- tests/integration/adapter-tools/matrix.test.ts tests/integration/adapter-tools/fixtures.ts tests/integration/adapter-tools/preflight-review/preflight.ts tests/fs/webdav/mock.ts tests/integration/adapter-tools/atomic-webdav-profile/atomic-mock.ts tests/integration/adapter-tools/atomic-webdav-profile/controls.ts
```

It exits 1. Do not solve that by rewriting the old evidence or by skipping the
assertion in a current gate. A caller attempting to reuse this historical one-shot
script for canonical qualification needs an explicitly authorized migration to
revision-bound original authentication plus the exact permitted current diff.
The new verifier implements that separate contract only inside its owned subtree.

## Auto-discovered candidates inspected, not broadened into new cohorts

- `tests/commands/diff-patch-stress/routed-five-review/review.test.ts` references
  archived snapshot/table JSON that contains old matrix hashes. Its assertions
  compare the historical captured objects and archives, not current matrix bytes.
- `tests/plugins/qualified-current-release-native-data/controls.test.ts` reads a
  prior inventory containing the matrix. Its root-config assertions concern the
  exact native-data exclusion, not an old live matrix/fixture hash. Config is
  unchanged by 3bf; no broad config/fixture cohort was rerun here.
- `tests/shell-stress/canonical-profile-review/acceptance-integrity.test.mjs` reads
  historical global compiler inventory; the matrix reference there is not a
  live-original matrix equality assertion. It is not npm's `.test.ts` discovery.

No affected npm-discovered live-original matrix/fixture hash failure was found
in this bounded inspection. That is deliberately **not** an all-canonical-tests
pass claim. The reproduced stale audit above remains explicit; no skips, blanket
seal updates, historical-input rewrites or root configuration fixes are applied.
