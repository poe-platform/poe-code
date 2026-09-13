# Drawing preservation follow-up

Scope: the existing solid/gradient/picture/pattern fill, line, alpha and simple
shadow subset. This is a bounded follow-up, not execution of the whole pipeline
or a claim of complete model API parity. Root owns implementation and integration;
the delegated research worker owns this plan and
`docs/pptx/drawing-followup-evidence.md`; the adapter worker owns its agreed
safe-bash acceptance scope. Preserve unrelated files. No README edits, push,
release or downloaded fixture commits.

Authority: root `AGENTS.md`, `docs/specs/pptx.md`, the shared office CLI/SDK
contracts, drawing case/API ledgers, both upstream audits/inventories, language
mappings and corpus manifest. No scoped `AGENTS.md` exists under `docs` or
`packages/pptx` at this checkpoint.

Procedure:

1. Reconcile every selected parameter/example identity against the pinned
   inventory; check uniqueness and that cited original test titles exist.
2. Inspect preservation and bounds behavior. Reproduce meaningful defects in
   small original in-memory tests before implementation. Do not use source
   runtime fixtures, downloaded files, or implementation-derived assertions.
3. Verify missing versus explicit no-fill, theme references, mixed color forms,
   bounds and advanced-effect preservation through model SDK and exposed typed
   operations. Verify actual safe-bash CLI through its owning worker.
4. Run maintained focused tests and package lint/type checks appropriate to the
   changes. Record actual results in the parent delivery; research identity and
   title checks alone do not establish passing behavioral coverage.
5. If disposable corpus QA is performed, use only manifest-listed cache inputs
   and the existing drawing QA procedure. Record which inputs actually ran and
   reduce meaningful findings to original tests. No download-dependent unit tests.
6. After checks pass, root commits explicitly named owned files and relevant
   plan/evidence updates on main. Report local commit hashes separately. Do not
   push, release, or create a read-only research commit with no changes.

Research checkpoint: 295 selected source rows are unique and resolvable (226
unit variants, 69 expanded scenarios); 34 unique original test references resolve.
The API ledger retains 223 unique resolvable records. Broader owner and API gaps
remain explicit in the companion evidence. The implementation owner reproduced
three failures covering missing-fill insertion order and namespace-qualified
selection of gradient stops, then applied focused fixes. Final maintained check
results belong to the integration receipt.

## Integration receipt

The three new model cases failed before the fixes and passed afterwards. The
final PPTX workspace unit run passed 97 files / 2,767 tests, including three new
CLI opaque-effect cases. Focused registered-shell tests passed all five cases.
The new model cases complete in milliseconds and use original in-memory XML;
command tests use memfs and original in-memory package bytes.

`npm run lint --workspace=pptx` passed source ESLint and production/test type
checks. `npm run build:workspaces -- --workspace=pptx` passed the three declared
builds. Built public package imports passed an original pattern/theme/alpha and
zero-opacity shadow round trip. An initial manual smoke invocation omitted
`new` for `Inches`; correcting the invocation to the declared constructor passed.
This was a QA invocation error, not a product defect.

The maintained safe-bash type check exposed two excess-property errors in
`tests/commands/pptx/create.test.ts`: the inferred helper parameter excluded the
supported optional `validationLimits`. The helper now uses the public command
engine context type. No product validation was weakened. Initial guarded lint
was intentionally interrupted to apply this confirmed repair; only the later
completed final run counts as lint evidence.

### Disposable and visual QA

Verified manifest entry `.cache/pptx-corpus/IXPE-Presentation-Template.pptx` against
SHA-256 `885e923f148cdf4680372abe54496c824ab3a2a2d8a59fd9703d66e0aeb1164c`.
An initial search found no existing slide shapes with both geometry and missing
fill, so it provided no missing-fill mutation evidence. On disposable standalone
shape views, explicitly removed the fill to inheritance and applied gradient and
pattern model edits: 40 checks preserved all original remaining child markup
and placed fill after geometry. No advanced effect siblings occurred in these
40 checks; original regressions cover that boundary. No corpus bytes were
changed or published and no rendering fidelity is claimed.

Captured actual `shapes drawing set --help` output using the terminal-png
renderer to `/tmp/pptx-drawing-followup-help.png` and inspected the screenshot:
readable, unclipped flags, selection, publication controls and preservation
limits. The root CLI has no pptx route, so the direct command-engine capture is
the applicable screenshot route. No permanent QA script or screenshot test was
added. Independent read-only review found no blocker in either structural fix
or the opaque-effect acceptance assertions.

### Completed final checks

- `npm run lint:eslint`: complete, exit 0, 11,985 configured files linted,
  zero errors and warnings. Interrupted earlier attempts are not passes.
- `npm run typecheck --workspace=virtual-bash`: passed source/tests and all
  26 current consumer groups; expected negative consumers were rejected.
  This is type evidence, not runtime qualification of those consumers.
- Focused `node --import tsx --test` on the PPTX create and fields command files:
  49 tests passed. The context repair is only a type import/annotation; unrelated
  file formatting was retained.

Delivery is local-only on main. No push, release, README change, full pipeline,
corpus publication or ignored fixture staging is authorized or performed.
