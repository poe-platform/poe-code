# Conversion lifecycle and output inference: executed QA

Executed 2026-09-19 in the authorized worktree. No README edits, commits, push or publication were performed. Existing tracked and untracked work was preserved. Implementation is TypeScript ESM in `packages/ssconvert`; Safe Bash exposes the virtual command `ssconvert`. CLI and SDK share the conversion engine, injected byte I/O, cancellation and workbook capabilities. Native execution is exclusively a separate QA oracle, never a product dependency or fallback.

## Reference and procedures

Use [the captured lifecycle oracle](ssconvert-lifecycle-oracle-qa.md) for source provenance, dependency/plugin/locale census, exact diagnostics and namespace observations. The unchanged Gnumeric 1.12.61 archive was authenticated against SHA-256 `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`; acquisitions were confined to `out` and the isolated oracle's `/out`. The fresh oracle binary SHA-256 is `d7b57fbb10a99097326d381f6e8c6ab9150092fca78cd03d7f41e5c968d64e82`. Its Debian trixie arm64 profile is distinct from the incomplete historical profile; neither establishes universal parity. The record retains 46 ordinary, 13 publication, 15 follow-up and 10 final selection/image-option observations.

Procedures: compare compound flag invocations with the source stages and captured oracle; reproduce validated differences with original small in-memory fixtures; implement repairs; run maintained package checks and the selected uncached build closure; independently stress the actual shared engine and VFS publication composition; inspect screenshots of public virtual-command diagnostics and inferred naming. Unit tests use memfs and injected/mocked capabilities, with no native spawning, host file creation or LLM queries.

## Implementation and regression evidence

`conversion-lifecycle.test.ts` and existing engine/CLI tests established failing controls before their corresponding repairs: inferred extension/status precedence; exporter/importer/load/options ordering; merge skipping updates; compound goal/solve/tool/resize/recalc/range ordering; reverse-sheet resize; output selection; and image-option validation. The independent reviewer reproduced overlapping publication cleanup failure (`ENOENT`), cleanup/acquisition races and measured post-rename chmod EACCES failures before repairing them. [Independent stress evidence](ssconvert-conversion-lifecycle-stress-qa.md) retains intermediate failures and final results; assertion weakening or timeout increases were not used.

The engine now resolves output mode/type/name before ordinary forced importer resolution, loads and applies native text updates only in ordinary/clipboard paths, validates exporter options before merge, then runs goal seek, solve, native tool-test, resize, explicit and automatic recalculation, range/default-sheet selection, and sequential save/split. Optional numerical/rendering capabilities are checked when their stage is reached. Codec selection receives the selected sheets/range. Unsupported stages do not become inferred successes.

Explicit `-T` with INFILE alone uses reference local-file URI extension semantics: dotless `plain` becomes `plaincsv`, `.hidden` becomes `.csv`, and `tail.` becomes `tail.csv`. No exporter/output exits 1; unknown inferred extension exits 2 before importer/load. There is no guessed same-format overwrite shortcut. Local URI canonicalization and source-compatible split substitutions/order are shared by CLI and SDK.

The authorized VFS publication adapter follows measured local libgsf behavior: private exclusive same-directory temporary output, rename on success, mode restoration, same-file replacement, hardlink separation and terminal-symlink preservation. ENOSPC removes unpublished temp; rename EACCES leaves the completed private temp; measured chmod EACCES after rename succeeds silently. Sequential split collisions overwrite, failures preserve prior published outputs, and aggregate output-byte limits remain enforced. Cleanup is registered before acquisition, closes admission and shares settlement across concurrent callers. This grants no additional host authority or crash-rollback guarantee.

## Completed checks

| Executed route | Result |
| --- | --- |
| `npm run build:workspaces -- --workspace=@poe-platform/safe-bash --no-cache` | Passed: selected 18-build closure, maintained declarations reporting 85 workspaces/235 edges |
| `npm run build:workspaces -- --workspace=@poe-code/ssconvert --no-cache` | Passed after final engine changes |
| `npm test --workspace=@poe-code/ssconvert` | Fresh maintained lifecycle passed: 397/397, 28 files; independent stress 24/24 |
| `npm run lint --workspace=@poe-code/ssconvert` | Passed ESLint and product/test TypeScript |
| `npm run test:runner --workspace=@poe-platform/safe-bash` | Passed 558/558 |
| `node --import tsx --test packages/safe-bash/tests/commands/ssconvert.test.ts` | Passed 19/19 |
| `npm run lint:eslint` | Complete exit 0, 0 errors/4 warnings; 16,534 configured inputs linted; receipt accounting complete |
| `npm run typecheck --workspace=@poe-platform/safe-bash` | Failed before consumer checking: public SafeFS shared-runtime identity guard |

The failed maintained typecheck expects root export `./safe-fs` to identify `./packages/safe-js/dist/safe-fs.js`, but reads undefined. Its report has builds=0, currentConsumerGroups=0, runtimeExecutions=0 and cleaned=true. Root export migration and the guard were preserved; no assertion bypass or speculative unrelated repair was made. Passing build/package checks do not replace this failed consumer gate.

Visual QA used the maintained `npm run screenshot -- --no-header --output ...` route with a temporary invocation host of the actual built public Safe Bash command. Inspected three screenshots: `ssconvert --recalc -O bad=1 input.csv output.csv`, `ssconvert -T Gnumeric_stf:stf_csv 'no suffix'`, and `ssconvert --export-graphs -T png -I bad input.csv graph.png`. Diagnostics were readable; invalid exporter options preceded recalc, suffix-free output was `no suffixcsv`, and forced-importer precedence was visible. Capture commands succeeded; negative underlying commands exited 1 as intended. No screenshot tests were added.

## Remaining mismatches and unqualified boundaries

- Numerical goal-seek/solver, formula/text/resize/recalculation algorithms, binary formats, rendering and clipboard fidelity require injected implementations. Stage mocks qualify ordering only, not these algorithms, native format-loss warnings or all codec failure effects.
- Native graph export with no objects can succeed without opening output even for unknown format IDs/extensions. The product requires a renderer binding; unsupported capability failure is a mismatch, not a pass.
- Native early clipboard-update failure can emit nondeterministic shutdown leak/address/PID/time diagnostics. Product source diagnostics do not claim those complete native bytes.
- Native uid/gid restoration is unavailable through the authorized VFS contract. Permission/inode tests use memfs; real provider enforcement and atomicity are not qualified.
- The optional byte filesystem without `openOutput` keeps its explicit host write policy; it does not promise native atomic publication. External races, crash effects, symlink cycles, remote aliases and unmeasured errno variants are not passes.
- Image numeric parsing is not a complete implementation of C atof hexadecimal-float grammar. Overflow resize is explicitly unsupported. Range parsing does not implement the complete complex-name/3D native dialect. These unmeasured cases remain unqualified.
- Optional plugins, arbitrary source templates, every format-loss warning, actual full-filesystem exhaustion and host permission profiles remain unmeasured. Cancellation/budget tests establish product capability invariants, not native cancellation/resource-limit equivalence.
- The maintained cross-workspace consumer typecheck remains failed as recorded above. No release or global/native parity claim follows from these checks.

Temporary source trees, logs, screenshots and raw observations under the two owned `out/ssconvert-lifecycle*` directories were reduced into these records. The owned isolated oracle container was removed. Automatic approval review rejected recursive removal of the two directories because they also contain captured profiles/observations and could lose irreversible evidence; both directories remain pending cleanup approval. No indirect deletion workaround was attempted. Other output directories, containers and unrelated workspace edits were retained.
