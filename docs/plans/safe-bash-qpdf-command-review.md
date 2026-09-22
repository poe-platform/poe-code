# command-qpdf diff review

Reviewed the current working tree on 2026-09-21. Completion is blocked by the findings below. Existing contributors' edits, including plan statuses, were preserved.

## Validated unresolved findings

1. **No command implementation to review.** Filesystem checks found neither `packages/safe-bash-command-qpdf` nor `packages/safe-bash/src/commands/qpdf/index.ts`. JSON-parsed `packages/safe-bash/package.json` has no `./commands/qpdf` export, command dependency, or qpdf private build profile. An actual CommandDefinition, SDK, optional plugin and installed runtime/declaration export are missing.
2. **Prerequisite parser and writer are unavailable.** The shared parser plan leaves `pdf-byte-syntax`, `pdf-revisions` and `pdf-parser-api` implementation open. The existing PDF package exposes rendering rather than the required raw-object/revision API. Its serializer imports `pdf-lib`, requires contiguous generation-zero identities, rejects Encrypt and ID, and writes only Root/Info trailer entries. It cannot supply the requested zero-external-dependency graph rewriting semantics.
3. **Command completion status lacks implementation evidence.** The existing task diff changes `command-qpdf` implementation from open to done despite the absent package and export. This review does not revert that edit; the claimed completion cannot be verified.

There is no qpdf runtime diff on which to validate unnecessary abstractions, proxy-only functions, duplication, unsafe host access or compatibility regressions. Cancellation, failure paths, cleanup, resource budgets, byte ownership, scoped grammar, native exit statuses and snapshot/version compatibility remain unverified. Existing pinned native controls are research evidence, not passing candidate checks. All unexecuted acceptance cells remain open.

## Required next work

Qualify the shared parser and first-party graph writer before composing the actual private command. Use failing memory-VFS tests for CLI/SDK equivalence and command lifecycle behavior, then integrate through the maintained private-workspace build path. Verify installed runtime and declarations without the unpublished workspace, canonical contract identity and unchanged default registration. Retain the full 140-option status inventory and documented deliberate safety deviations.

The requested package-pattern document is moved in existing edits; this review used [its archived counterpart](archive/safe-bash-command-package-pattern.md). It disallows empty scaffolds and requires a real command candidate. Adding an unsupported-only handler would not resolve these findings.

## Verification limits

Executed filesystem checks, parsed-manifest checks, task-diff inspection and serializer/parser-plan inspection. No code was changed, so no TDD cycle or affected runtime checks could be run. No screenshots, native controls, installed-consumer checks, commits, pushes, releases or publication are claimed. Only this review document was added.
