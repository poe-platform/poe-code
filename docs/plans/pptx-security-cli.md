# PPTX security admission through the shell

Owned scope: `packages/safe-bash/tests/commands/pptx/metadata.test.ts` and this plan.
The existing registered test file avoids changing the independently owned test
discovery inventory. Product security implementation belongs to the PPTX owner.

## Original regressions

Construct a small original presentation archive entirely in memory and add one
security marker without a relationship: a renamed macro payload content type,
the conventional macro part basename, a signature content type, or a signature
directory part. Keep the `.pptx` suffix in every case. A presentation modification
verifier is the protected-content control. A renamed orphan classification-label
content type additionally exercises label admission without relying on its path.

Invoke the actual Shell `pptx properties set` route with quoted filenames and
`--output - --force`; require status 1, `unsupported-edit`, and zero binary output.
Repeat through `--dry-run --json`; require the same error and zero affected items.
Independently compare the original memfs bytes and directory listing. Retain the
existing successful property/tag mutation test as a positive control.

The fixtures are original synthetic byte/XML assets, independent of downloads.
The source audit and inventories in `docs/pptx` were consulted; these adversarial
F55 cases supplement source behavior accounting rather than establish whole-API
or BDD parity. The disposable corpus manifest is not a canonical unit dependency.
No source identities or derived source assets enter tests or product output.

## Validation

Red: `node --import tsx --test packages/safe-bash/tests/commands/pptx/metadata.test.ts`
reported four failures: all orphan macro/signature inputs incorrectly returned
status 0. Protection and existing ordinary metadata coverage passed (2 passes).
This reproduction used the public built `pptx` import and actual shell adapter.

Green after the security owner's maintained `npm run build:workspaces -- --workspace=pptx`:
`node --import tsx --test packages/safe-bash/tests/commands/pptx/metadata.test.ts packages/safe-bash/tests/commands/pptx/opaque-objects.test.ts`
passed all 12 cases (7 metadata/security and 5 opaque-object cases), no skips,
in 1.33 seconds. The label case supplements the initial CLI red cohort; its SDK
red reproduction belongs to the security owner's evidence. Root coordinates
maintained package checks and the atomic local commit. No push, release, complete
pipeline, corpus downloads, or README edits are part of this slice.
