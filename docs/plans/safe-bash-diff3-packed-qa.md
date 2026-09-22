# ship-diff3 packed export and documentation QA

## Current candidate audit, 2026-09-19

Executed the Markdown procedure below against the current working tree. The
only product-documentation addition in this audit pins the official GNU 3.12
archive SHA256 in the command README. Existing flags, examples, numeric limits,
outputs, safety deviations and safe-bash usage sections were already present.
No implementation, shared build configuration or test source was changed.

- Passed: maintained command unit route (399 tests; zero failures, cancellations
  or skips), command lint/source and test typechecks, README formatting, and
  selected maintained safe-bash build closure with shared cache enabled and
  native postbuild events.
- Passed: public artifacts staged as `0.0.0-ship-diff3-audit`, locally packed
  with lifecycles disabled and offline-installed outside the checkout. Private
  diff3/contracts packages were absent. Installed runtime fixtures and strict
  NodeNext declaration checks passed for default, browser and workerd conditions.
- Passed: AST parsing of 1,264 installed JavaScript/declaration files, with no
  bare private command/contracts imports or private manifest dependencies.
  Browser-platform browser/workerd bundles each had 55 first-party inputs and
  zero external imports; portable bundle fixtures executed under Node.
- Passed: installed runtime with Node permissions restricted to consumer reads
  and no child/native-process permission. Independent installed controls covered
  grouped/repeated selector output, X/x equivalence, unflagged merge status,
  ambiguous prefixes, rejected external executable selection and multiple stdin,
  empty/newline label safety, identical-change conflicts, pre-abort falsey
  reasons, producer byte reuse and idempotent engine disposal.
- Inspected: `npm run screenshot-poe-code -- --help` using an explicit output
  path, and installed report/merge/ed output via the maintained screenshot
  renderer. The first installed capture had an excessively long command header;
  recaptured with `--no-header` to inspect readable output. Statuses were 0/1/0.
- Unverified: actual browser/workerd engines (neither executable was available),
  universal GNU alignment parity, and a fresh native GNU comparison. Condition
  resolution and Node execution do not qualify other runtime engines. No
  original/checkpoint/replay integration changed; existing installed owned-byte
  replay checks passed. No performance measurement was claimed.
- Not run: full repository test/lint/build gates (documentation-only edits),
  document-rendering QA (no renderer changed), and publication/release checks.

`/out` creation failed because the filesystem is read-only. Task-owned ignored
`out/ship-diff3-audit` and an isolated `/private/tmp` consumer were used and
purged after inspection. Other pending edits were preserved. Local commits,
verified remote-main delivery and successful releases: none. No package was
published.

Verify the existing private diff3 owner and installed public API, without
speculative runtime repairs or standalone command publication.

1. Inspect the command manifest, TypeScript facade, safe-bash export/profile and
   package-pattern instructions. Preserve the pending pattern-document move;
   read `archive/safe-bash-command-package-pattern.md` as its current location.
2. Run the owner's maintained unit and lint/typecheck routes. Build the maintained
   selected safe-bash workspace closure, retaining declared prerequisites/events.
3. Stage public safe packages with `scripts/package-safe.mjs`, pack with lifecycles
   disabled, and offline-install public tarballs in a consumer outside the checkout.
   Confirm private command/contracts workspaces are absent.
4. Execute the maintained diff3 runtime and declaration fixtures under default,
   browser and workerd conditions. Use strict NodeNext, exact optional properties,
   unchecked indexed access and no skipLibCheck. Exercise report/merge/ed,
   CLI/SDK equivalence, canonical identity, replay ownership, quota failure,
   aliases, registration, VFS errors and stdin/executable-selection rejections.
5. AST-inspect packed JavaScript/declarations and manifest dependencies for leaked
   private imports. Bundle the installed command graph for browser/workerd with
   browser platform resolution and inspect its dependency metadata. Distinguish
   condition-resolution checks from actual runtime-engine execution.
6. Execute the installed runtime fixture with Node filesystem permissions limited
   to the consumer, without child/native-process permissions. Capture and visually
   inspect installed Shell report/merge/ed output using the maintained terminal
   screenshot renderer. No snapshot tests or QA executable is added.
7. Verify documentation against inspected parser/defaults/contracts, record the
   evidence below, and purge task-owned staging, tarballs and consumer artifacts.

## Verification receipt, 2026-09-19

The owner is `packages/safe-bash-command-diff3`, named
`safe-bash-command-diff3`, private, TypeScript ESM, with empty runtime dependencies.
The safe-bash facade only re-exports its API at
`@poe-platform/safe-bash/commands/diff3`. Existing private build/packing profiles
include implementation and declarations and preserve canonical contract identity.
No runtime defect was found requiring a change in this audit.

Documentation now includes exact short/long flags, fixed-inventory prefix rules,
shell examples, numeric defaults, output/status contracts and runtime limits.
Existing safe-bash support prose was updated without adding a new section.
The GNU 3.12 unflagged X behavior, identical-change conflicts, common-file
selection, stdin spooling, ed label safety, missing-LF/CR behavior, resource
cutoffs and redirect publication limits remain explicit.

- `npm run test:unit --workspace=safe-bash-command-diff3`: 399 passed, no
  failures/cancellations/skips. Memory-VFS/mocked-capability tests only.
- `npm run lint --workspace=safe-bash-command-diff3`: passed ESLint and both
  source/test TypeScript checks.
- `npm run build:workspaces -- --workspace=@poe-platform/safe-bash`: passed
  declared prerequisite closure and native postbuild event, with shared cache
  enabled. This receipt reported 17 builds and zero hits; these counts do not
  define task membership or substitute for fresh/full repository verification.
- Public safe-fs/safe-js/safe-bash artifacts were staged as
  `0.0.0-ship-diff3`, packed locally and offline-installed outside the checkout
  with lifecycle scripts disabled. Private diff3/contracts packages were absent.
  The complete safe-bash package retains its existing unrelated dependencies;
  the diff3 dependency graph contains only first-party safe-bash/safe-fs code.
- `scripts/fixtures/safe-packages-diff3.mjs` and
  `scripts/fixtures/safe-packages-diff3-types.mts`: passed installed runtime and
  strict declarations under default, browser and workerd conditions.
- AST inspection: 1,264 packed JS/declaration files parsed successfully with no
  bare private command/contracts imports; no private manifest dependency leaked.
- Browser-platform esbuild bundles under browser and workerd conditions passed;
  each metadata graph had 55 first-party inputs, no third-party runtime modules,
  external imports or Node builtin shims. Both bundles executed their portable
  merge/registration fixture under Node. An initial graph assertion incorrectly
  excluded canonical public safe-fs; inspecting the metadata established that
  these were first-party inputs, and the audit predicate was corrected. No
  product assertion, runtime implementation or dependency was changed.
- Installed runtime fixture passed under Node permissions allowing reads only
  within the consumer and no child/native-process permissions.
- Installed report/merge/ed screenshot was captured with `scripts/screenshot.ts`
  and inspected: report indentation and conflict markers were legible, ed w/q
  appeared as generated text, and statuses were 0/1/0. The
  `npm run screenshot-poe-code` wrapper targets the root poe-code CLI, whose
  rendering was unchanged; this capture used the same maintained renderer on
  the installed Shell consumer. No document renderer was changed, so generated
  document screenshots were not applicable.

Actual browser and workerd engines were unavailable and remain unqualified;
Node condition resolution/bundling is not engine execution. Universal GNU
alignment parity and costly-search shortcut support are not claimed. Changes
in this task are documentation only; no shared runtime/build changes were made,
and no full repository test/lint/build or release verification is claimed.

`/out` is read-only on this machine. Temporary task evidence used ignored
`out/ship-diff3` and an isolated system temporary consumer, then was purged after
durable capture. Unrelated pending edits were preserved.

Local commits: none. Verified remote-main delivery: none. Successful releases:
none. No private command package was published.

## Independent recheck, 2026-09-19

Re-executed the Markdown steps against the current working tree after adding a
byte-only SDK example, a named limits table and explicit pure-API exception
behavior to the command README. Existing safe-bash usage/support already covers
the subpath and qualified runtime; no further shared changes were needed.

- Maintained diff3 unit route: 399 passed, zero failures, skips or cancellations.
  Maintained package lint and source/test typechecks passed.
- Selected safe-bash build closure passed with shared cache enabled, including
  native postbuild events. No full repository unit/lint gate is claimed for this
  documentation-only change.
- Staged public packages as `0.0.0-ship-diff3-recheck`, packed with lifecycle
  scripts disabled, and offline-installed outside the checkout. Neither
  `safe-bash-command-diff3` nor `safe-bash-contracts` was installed separately.
- Installed diff3 runtime and strict NodeNext declarations passed under default,
  browser and workerd conditions. Declaration checks included exact optional
  properties, unchecked indexed access and library checking.
- Parsed 1,264 packed JavaScript/declaration files; no private command/contracts
  import or manifest runtime dependency leaked. Browser-platform bundles for
  browser/workerd each contained 55 first-party inputs, with no external imports
  or third-party runtime modules; both portable fixtures executed under Node.
- Installed runtime passed Node permissions allowing reads within the consumer
  and no child/native-process capability. The canonical `/private/tmp` consumer
  path avoids macOS's `/tmp` alias during loader permission checks.
- Inspected installed report/merge/ed output via `npm run screenshot`: indentation,
  all conflict sections and generated ed w/q text were legible; statuses were
  0/1/0. Also ran and inspected `npm run screenshot-poe-code -- --help` with an
  explicit task-owned output path. No document renderer changed.
- README formatting passed after formatting; source review found no validated
  runtime or packaging defect requiring a repair. Reviewed option inventory,
  quotas, copied byte ownership, cancellation/cleanup, alignment qualification,
  private bundling and canonical contract identity. No speculative simplification
  or code/test change was made.

The temporary bundle audit initially misinterpreted esbuild's relative metadata
paths; resolving them against its declared working directory fixed the audit.
An initial Node permission run used the `/tmp` alias and failed in the loader;
the canonical-path rerun passed. These were verification setup errors, preserved
here separately from product results. No actual browser/workerd executable was
available; condition resolution, browser bundling and Node execution do not
qualify those engines. This remains an explicitly documented runtime limitation,
not a claimed pass. Universal GNU alignment parity remains outside the profile.

`/out` creation was rejected by the read-only filesystem. Task-owned evidence
used ignored `out/ship-diff3-recheck` and an isolated temporary consumer and was
purged after inspection. Unrelated pending edits were preserved. Local commits,
verified remote-main delivery and successful releases: none. No publication was
performed.
