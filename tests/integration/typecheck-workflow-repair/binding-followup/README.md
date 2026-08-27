# Mixed declaration binding repair — author checkpoint, 2026-08-27

Source/harness **a01310c5571dfda2aae4c6c8cc185e2530a01e89**. Different review is
required. Plato31e24055's original **20/21 controls and withheld acceptance**
remain unchanged; this is not an independent closure or a whole-product gate.

## Reported defect and exact change

The original helper accepted any trace containing one copied-build resolution
and no repository-src substring. A root import from the real candidate plus
`virtual-bash/contracts` from a decoy build therefore qualified. The decoy's extra
export was absent from the candidate; actual TypeScript and the complete warm
command still passed with the paths override. No product type error was required.

The repair snapshots the candidate package metadata and177 declaration hashes
once after build/prerequisite checks. All source/moved groups share that binding.
For every successful public root/subpath resolution, the guard now requires the
candidate's physical dist location, authenticated declaration bytes and the
actual types export specified by its package metadata, including the existing
contracts wildcard. Relative declaration imports inside the package and the
supported private localPackage leaf route are also bound to that same build.
Each checked package must retain the exact declaration set/bytes and metadata;
candidate build symlinks are refused rather than used to hide a foreign build.
Normal OS directory aliases are canonicalized. External nonproduct typings are
not required to belong to virtual-bash and remain accepted.

No blanket paths-override ban, fabricated module identities, changed diagnostics,
product source, public API, root type exclusions, dependency or fixture expectation
is introduced. Warm dist is authenticated as the supplied build; no new claim
that it is fresh relative to changing source. The combined command still builds
once; a frozen release must independently bind that build to its selected source.

## Frozen author observations

Base **c5d44262ecca11009df6ce32a180005d3f3cb574** plus exactly ten hashed owned
workflow overlays matches a01310c5. No dirty foreign source/fixture is copied.
Node22.22.2 and the existing copied development tools; no installs or private
checkout writes. All temporary input mutations are restored; the isolated
candidate, compiler workspaces, npm cache/config and copied tools are cleaned.

| Observation | Actual result |
| --- | --- |
| Cold command |78, explicit prerequisite, zero compiler work |
| Legitimate combined command |0; one build; global types and selected-GNU route pass |
| Strict current source / moved groups |3/3 and19/19; zero runtime executions |
| Exact negative diagnostics |unchanged1+2+5 |
| Real missing export without mapping |compiler TS2305 |
| Real root plus decoy contracts mapping |compiler0; binding guard rejects |
| Complete warm `npm run typecheck` with that mutation |exit2, zero builds; env-split-public-types rejected specifically for foreign contracts declarations |
| Wrong export inside the correct build |compiler0; public-export-path guard rejects |
| Foreign declaration symlink / changed candidate bytes |compiler0; candidate authentication rejects |
| Full bounded author controls |22/22; includes unchanged24/24 runtime-coverage controls, not24 provider passes |

The complete warm negative uses the reviewer's actual extra export and paths
override. It is not a forged trace or stub compiler. The source groups remain
successful; exactly the affected moved group fails binding. Its dependent
negative group is not treated as a pass after positive qualification fails.
Native/runtime tests are not executed by these compiler observations.

The old synthetic substring control in the author runner is replaced with an
actual copied package plus explicit resolution records because the helper now
requires a real authenticated artifact. Original b9559de5 source and all33 old
captures remain immutable; no independent reviewer fixture is edited.

## Independent handoff

Please rerun the failed mixed-package full-command control, legitimate current
groups/localPackage leaf, missing-export TS2305, source fallback and nearby
symlink/path cases. Also check same-build wrong-export mappings and changed bytes.
This is a trusted-development-configuration guard, not hostile-JavaScript isolation
or a universal TypeScript language-resolution implementation. Until that review,
the new workflow is **not independently accepted**.

```sh
node tests/integration/typecheck-workflow-repair/binding-followup/verify.mjs
node tests/integration/typecheck-workflow-repair/run.mjs /tmp/NEW-EXCLUSIVE-OUTPUT
```

The read-only verifier authenticates12 complete captures, source blobs, the
legitimate groups and actual warm rejection. The second command performs only
bounded compiler/harness controls and records its own candidate/overlays; it is
not authorization for a whole-product suite or reclassification of old results.
