# ship-soffice verification

Reviewed the current working tree on 2026-09-20. Preserved unrelated edits.
The requested pattern document has moved to
[archive/safe-bash-command-package-pattern.md](archive/safe-bash-command-package-pattern.md);
its current ownership, packaging and acceptance instructions were inspected there.
This task changes only the command README, the existing Safe Bash support paragraph
and this Markdown QA/receipt. No runtime, export map, registration, dependencies,
build routes or declaration rules changed; no runtime defect was reproduced and
no code change required a TDD cycle.

## Markdown QA

1. Read command arguments, command/SDK execution, budget, CSV options/text/sheet
   primitives, filter resolution, engine/model interfaces and capability gates.
   Inspect private manifest, Safe Bash composition export and packaging pattern.
2. Run `npm test --workspace=safe-bash-command-soffice` and
   `npm run lint --workspace=safe-bash-command-soffice`.
3. Run `npm run build:workspaces -- --workspace=@poe-platform/safe-bash`, including
   native npm postbuild, then `node --import tsx --test
   packages/safe-bash/tests/plugins/soffice-wiring.test.ts`.
4. After build completion, stage using `node scripts/package-safe.mjs --out-dir
   out/ship-soffice/stage --version 0.0.0-ship-soffice-review`. Pack only staged
   public SafeFS, SafeJS and Safe Bash using `npm pack --ignore-scripts`.
5. Install public tarballs offline in a fresh OS temporary consumer outside the
   checkout with scripts, workspaces and optional dependencies disabled. Assert
   private soffice/contracts packages are absent. Copy and execute maintained
   `scripts/fixtures/safe-packages-soffice.mjs` normally and with Node
   `--conditions=browser` / `--conditions=workerd`.
6. Compile maintained `safe-packages-soffice-types.mts` using strict NodeNext,
   ES2023, exact optional properties, unchecked indexed access and Node types,
   without skipLibCheck, normally and with matching `--customConditions`.
7. Inspect packed manifest subpath targets; scan all packed JS/declarations with
   TypeScript AST traversal for bare private command/contracts import/export,
   import-type and dynamic import/require references.
8. Under browser/workerd conditions, bundle a public-only Shell help/conversion
   denial and CSV serialization witness with esbuild's browser platform; execute
   in Node VM realms with explicit web capabilities and no Buffer/process/require.
   Inspect the soffice-only bundle graph for third-party runtime dependencies.
9. Extract both README TypeScript examples verbatim and execute in the installed
   consumer. Review documentation and `git diff --check`; purge task evidence.

## Results

- Private package unit route: 62 passed; zero failures, cancellations or skips.
- Workspace lint: ESLint and production/test TypeScript checks passed.
- Maintained selected Safe Bash build closure passed, including postbuild; shared
  machine cache was enabled. The maintained runner derived the closure from
  workspace declarations, rather than a fixed task list.
- Focused Safe Bash integration: four passed; zero failures/cancellations/skips.
- Maintained installed runtime fixture passed under Node/browser/workerd conditions:
  event ordering, neutral flags/outdir, Unicode/literal BOM, malformed UTF-8,
  CSV sheet-selector token 12, capability refusal, close semantics, canonical
  runtime identity, explicit registration, literal SDK files and CLI/SDK parity.
- Strict installed declarations passed in all three condition profiles with
  library declarations checked. No private soffice/contracts workspace installed.
- Actual packed subpath targets are
  `./dist/safe-bash/commands/soffice/index.js` and
  `./dist/safe-bash/commands/soffice/index.d.ts`.
  The private implementation/declarations reside inside the public artifact;
  consumers do not need an unpublished workspace package.
- AST inspection of 1,325 shipped JS/declaration files found no bare private
  command/contracts references. This count records this candidate, not future
  test membership.
- Both conditional browser-platform VM bundles passed help, denied conversion
  without VFS effects, shell disposal and inert CSV serialization, without
  Buffer/process/require. Each soffice-only graph contained 55 inputs, all
  first-party Safe Bash/SafeFS files plus the synthetic entry point; no third-party
  runtime dependency or dependency source was found in that conditional closure.
- An initial extra graph assertion allowed only Safe Bash, so it rejected the
  first-party public SafeFS contract closure. Inspection identified those inputs;
  the harness was corrected to admit SafeFS as first-party, then both profiles
  passed. No product source, tests, assertions or deadlines changed.
- Both README examples ran verbatim against the installed candidate. Help/version
  identify admission-only behavior and the exact source snapshot. CSV emitted
  `name,value` and `"a,b",=1+1` with LF endings; the formula-like text stayed inert.
- Manifest remains `safe-bash-command-soffice`, `private: true`, TypeScript ESM,
  empty runtime dependencies. Safe Bash's command subpath only re-exports it.
- README documents commands/examples, exact accepted/denied flags, defaults,
  byte outputs, statuses, cancellation/cleanup and CSV primitive boundaries.

Candidate local tarball SHA256 receipts:

| Artifact | SHA256 |
| --- | --- |
| Safe Bash | `ffbdc6758fe23c6df6d443c4ab006988648765976f7c166c07e8489225ce4e37` |
| SafeFS | `b21baf7c2a3569228cfde774f1786d16bc99815fe0e8f2f9f86d855daa9a025f` |
| SafeJS | `2ee43e4c5f1617a179e3049d7334d0f86456e8d9a859eb822d7131c11f391efc` |

## Qualification boundaries

This qualifies local packed delivery of argument admission and existing
primitives, not Office conversion. All advertised conversion/layout capability
booleans remain false. Workbook import, displayed/raw number decisions, formula
semantics, loss-preserving DOCX/ODF/PPTX/XLSX layout, fonts/shaping, pagination,
notes/slides, PDF/A and PDF/UA remain open. Typed PDF options/defaults and
standards profiles are not admitted by a parser interface or generated PDF.

Compatibility source is LibreOffice/core
`d17755172ac96e54e3f10f35dd1b1680f0ef84bd`; installed app manifest 26.8.0.3 is
separate. Supplied native attempts failed before main in dyld and produced no
conversion output. No native parity evidence, native exit mapping, rendering or
standards compliance is inferred. No native Office executable was invoked here.

Actual browser/workerd engines and Bun were not exercised. Condition-selected
Node runtime/type checks and Node VM execution qualify graph/realm behavior only.
SafeFS is a public first-party contract dependency; the whole Safe Bash artifact
has separate external dependency contracts. No aggregate dependency-free claim
follows from this command manifest or scoped closure check.

Full repository routes were not run because changes are documentation-only;
focused maintained package lint/unit/build and installed checks are reported
above. CLI appearance and document rendering did not change; no new CLI or
rendered-document screenshots were required. Markdown QA was executed as steps,
not installed as a product QA script. Task file whitespace checks passed.

Absolute `/out` is read-only on this host. Ignored `out/ship-soffice` and the
external temporary consumer were purged after this durable receipt was recorded.
Local commits: none. Verified remote-main delivery: none. Successful releases:
none. No push or public/private publication was performed; this private package
was not independently packed or published.
