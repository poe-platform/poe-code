# ship-fmt verification

Reviewed the current working tree on 2026-09-20, preserving existing edits.
The requested package-pattern plan is currently at
[its archived location](archive/safe-bash-command-package-pattern.md).
This task changes only the fmt package README, the fmt paragraph in Safe Bash's
existing support section, and this verification document. No code, build logic,
registration, export map or snapshot was changed.

## Markdown QA

1. Run `npm test --workspace=safe-bash-command-fmt` and
   `npm run lint --workspace=safe-bash-command-fmt`.
2. Run `npm run build:workspaces -- --workspace=@poe-platform/safe-bash`.
3. Run `node --import tsx --test` with Safe Bash's fmt, fmt-adversarial and
   fmt-boundaries command test files.
4. Stage public artifacts with `node scripts/package-safe.mjs --out-dir
   <task-output>/stage --version <candidate-version>`. Pack only the staged
   SafeFS, SafeJS and Safe Bash packages using `npm pack --ignore-scripts`.
5. Install those tarballs offline into a fresh consumer outside the checkout,
   with scripts/workspaces/optional dependencies disabled. Assert private fmt
   and contracts workspaces are absent. Execute `safe-packages-fmt.mjs` normally
   and with Node's browser/workerd conditions. Compile `safe-packages-fmt-types.mts`
   under strict NodeNext, exact optional properties and unchecked indexed access,
   normally and with browser/workerd custom conditions; do not skip declaration checks.
6. Inspect the packed fmt export and parse all shipped JS/declarations to reject
   bare private fmt/contracts import, export, import-type or dynamic-import references.
7. Authenticate the released archive; read fmt.c, its Texinfo section and all
   upstream fmt tests, then compare the pinned development fmt.c. Do not execute
   host utilities or label source findings as native observations.
8. Review failure, cancellation, byte ownership, budgets, cleanup, profile and
   snapshot boundaries. Remove task-owned evidence after recording the results.

## Fresh results

- Private package unit route: 1,023 passed, zero failures/cancellations/skips.
- Package lint: ESLint and production/test TypeScript checks passed.
- Maintained Safe Bash build closure: passed, including native npm postbuild stages.
- Focused integration: 726 passed, zero failures/cancellations/skips.
- Public-only offline consumer: runtime and strict declarations passed under
  Node, browser and workerd conditions. Neither private fmt nor contracts was installed.
- Fixture exercised released width8 output, canonical runtime identity,
  cross-realm bytes, VFS files/scripts, pipelines, opaque byte prefixes,
  typed/raw SDK parity and plugin replacement.
- Packed fmt export: `./dist/safe-bash/commands/fmt/index.js` and corresponding
  `index.d.ts`. AST inspection of 1,275 JS/declaration files found no bare
  private fmt/contracts specifiers. Relative bundled implementation/declaration
  imports remain inside the public artifact.
- Manifest remains `safe-bash-command-fmt`, `private: true`, TypeScript ESM,
  with empty runtime dependencies. Safe Bash composes and exports its API.
- README documents exact flags, examples, LF/status behavior, explicit byte and
  locale profiles, window oddities, checked arithmetic, resource limits,
  coroutine ownership/cancellation and VFS cleanup. Safe Bash's existing fmt
  support paragraph now includes a concrete command and byte output.

Candidate `0.0.0-ship-fmt-review` tarball SHA256:

| Artifact | SHA256 |
| --- | --- |
| Safe Bash | `a0346e130ed8a2a72816feb1a13832d96e7329c22dcbd3e694813a62f49864b2` |
| SafeFS | `41ac6d6484c526998f28207c3bc401b294f5a7d9c2fa52e9e59eed4cd70543cc` |
| SafeJS | `b4a8fa7006b9e0dbe81d73ea26f1e25021a6f845ec0cad3c1a5cea3c8a71eb10` |

## Source and diff review

The freshly downloaded GNU coreutils 9.10 archive matches
`16535a9adf0b10037364e2d612aad3d9f4eca3a344949ced74d12faf4bd51d25`.
Compared with `b25722854370b8206d7f53f8934c36710cdd9974`, fmt.c differs only
in initialization placement/removal. Reviewed byte/c_isspace classification,
space/tab indentation, split/crown/tagged precedence, prefix matching, sentence
recognition, strict-less DP ties, integer costs, final-line cost, raw MAXCHARS
flush, MAXWORDS-2 flush and retained suffix/previous-line length. Read the fmt
Texinfo section and upstream base.pl, goal-option.sh, long-line.sh, non-space.sh
and width.sh. Width.sh explicitly gates inclusive width in 9.10. No native fmt
or host locale oracle was executed during this task.

No additional validated proxy-only abstraction, duplicated algorithm, host access,
byte-ownership or compatibility regression was found. No speculative code
simplification was made. Current tests verify the previously reported opaque
metadata cleanup blocker is resolved: late metadata cannot acquire a reader;
acquired readers/output still drain. Existing 8.30 fixtures remain under their
explicit historical profile; the default installed control uses released 9.10.

## Unresolved qualification gates

Actual browser/workerd engines have not been independently exercised; Node
conditional import checks qualify the installed export graphs only. Broader
combined punctuation/prefix/margin/tab/tie/window native qualification remains
open, as documented in the existing compatibility receipts. These are unresolved
qualification findings and block declaring full cross-runtime/GNU compatibility
complete. No currently failing selected test or newly validated implementation
bug remains. This receipt does not discharge those broader gates.

No CLI appearance or document-rendering implementation changed, so no new
screenshot validation was required. Existing screenshot evidence is recorded in
[compatibility-fmt.md](compatibility-fmt.md). Checks were scoped to this
formatting-command documentation/verification task; full repository test/lint
routes were not run and are not claimed. `git diff --check` passed.

Absolute `/out` is unavailable on this host; temporary evidence used ignored
`out/ship-fmt-current` and a task-created isolated consumer, then was purged.
Local commits: none. Verified remote-main delivery: none. Successful releases:
none. No private package publication, public publication, push or release occurred.

## Independent repeat verification

Repeated the Markdown QA against the live working tree based on
`35d01c57f8078d8afa916dc59929395d857e9c55`. Existing unrelated edits were preserved.
This repeat changes only the private fmt README and this receipt: it adds the
Node 22+ runtime requirement, qualifies browser/workerd conditional exports, and
shows both released width7/width8 examples. No code changed, so no new TDD cycle
was needed. Existing Safe Bash usage/support copy already covers this API.

- `npm test --workspace=safe-bash-command-fmt`: 1,023 passed; zero failures,
  cancellations or skips.
- `npm run lint --workspace=safe-bash-command-fmt`: ESLint and both production
  and test TypeScript checks passed.
- `npm run build:workspaces -- --workspace=@poe-platform/safe-bash`: passed,
  including postbuild stages, with the maintained shared-cache route.
- Fresh fmt/adversarial/boundaries integration: 726 passed; zero failures,
  cancellations or skips.
- Public tarballs installed offline outside the checkout. Maintained installed
  fmt runtime and strict NodeNext declarations passed normally and under browser
  and workerd conditions. Private fmt/contracts workspaces were absent.
- Inspected all 1,275 packed JS/declaration files using the TypeScript AST; no
  bare private fmt/contracts specifiers appeared. The fmt export targets remain
  `./dist/safe-bash/commands/fmt/index.js` and its `index.d.ts`.
- Independent packed byte controls passed: width7, width0, tab uniform spacing,
  unmatched prefix without final LF, formatted missing LF, and a 5001-byte word
  followed by ` end`. Negative controls passed for goal greater than width in
  either argument order, late legacy width, width2501, unavailable profiles and
  a two-byte input budget. These are deterministic checks, not performance or
  native-oracle measurements.
- Downloaded archive hash matched the supplied GNU 9.10 baseline. Read fmt.c,
  its Texinfo section and all five upstream fmt test files. Compared the pinned
  development fmt.c: only initialization placement/removal differs. No host fmt
  executable or ambient locale was used.

Candidate version `0.0.0-ship-fmt-session` tarball SHA256:

| Artifact | SHA256 |
| --- | --- |
| Safe Bash | `94170b17f813235601610a0ec0b7926b5a61449e1e05179399131869660f57bd` |
| SafeFS | `0f4fe986b5a55ec4a657e2c5494c315184e9912f7476db4e66341444a1ea76fb` |
| SafeJS | `cdc2ba7c258cb44d0f80118e2bde5e07cc2958e50c51c31d107a98290bc9398e` |

This authenticates the tested packed artifacts, not an immutable Git revision.
The tarballs precede the README-only additions in this repeat. Actual browser
and workerd engines, broader combined native compatibility controls, and full
repository gates were not executed or counted as passes. No CLI appearance or
document renderer changed; screenshots were not required for this copy edit.
There were no failing or incomplete selected runs. Absolute `/out` is unavailable;
task-owned ignored output and the isolated consumer were removed after capture.
Local commits: none. Remote-main delivery: none. Releases/publication: none.
