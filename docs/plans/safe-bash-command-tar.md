# Tar command workspace

## Ownership and compatibility

The extraction is delivered by `9ec52b1650` and subsequent fixes. Revalidated
against remote main `8110047fc3`: `safe-bash-command-tar` owns option parsing,
creation, extraction, listing, transformation, comparison and mutation. Safe Bash
retains composition and public compatibility facades. Canonical values, argv,
errors and cancellation contracts come from `safe-bash-contracts`; shared archive
I/O and compression remain in the lower-level private engines. Preserve subsequent
opaque-source identity, extraction-root diagnostic and input-ceiling fixes.

All command and engine workspaces remain private. Existing public Safe Bash
exports ship their bundled implementation and declarations. Consumers never
install private workspace names. Default command registration, replacement policy,
metadata, streaming, extraction safety, overwrite policy and limits remain intact.
No new runtime dependency or publication job is introduced by this completion.

## Verification plan

- Run the maintained Safe Bash dependency build and tar unit/type/lint routes.
- Retain existing tar unit and Shell archive regressions without weakening them.
- Run packaging and package-lint gates for private admission and public exports.
- Pack existing public libraries; install them outside the repository without
  private workspace links. Run the maintained tar fixture and strict NodeNext
  declaration fixture against that consumer.
- Exercise public root/subpath factories, registration/collision/replacement,
  raw/gzip/bzip2/xz pipes, VFS scripts, creation/listing/extraction/mutation,
  overwrite behavior, canonical values/errors, cancellation and explicit limits.
- Bundle the same fixture under browser and workerd conditions to qualify the
  advertised portable exports without host filesystem/process/network access.
- Verify delivery on remote main before closing the task. Release publication is
  separate and is not a completion prerequisite for this request.

The original missing-workspace characterization was recorded before extraction;
this completion adds distribution regressions to the maintained consumer fixtures.
