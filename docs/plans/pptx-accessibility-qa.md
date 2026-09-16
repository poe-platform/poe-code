# Accessibility integration QA

Scope: F52 accessibility metadata and structural checks only. Root owns command
engine/export wiring, integration review, disposable QA and local commits. Domain,
command and accounting workers own their explicitly assigned files. Preserve
unrelated image/media work, including unstaged hunks in shared integration files.

## Procedure

1. Reproduce missing accessibility SDK/CLI behavior in original memory-only tests
   before implementation. Check per-occurrence descriptions for shared images,
   explicit empty metadata, decorative booleans, layout provenance, title checks,
   and structural tree order with independently stated expected results.
2. Run maintained pptx unit/lint checks and the selected workspace build closure.
   Run registered safe-bash accessibility and neighboring command tests plus its
   exact registration guard and maintained typecheck. Do not run the full pipeline.
3. Read one cached presentation listed in `docs/pptx/corpus-manifest.json` only
   after matching its length and SHA-256. Inspect accessibility metadata through
   the SDK and actual injected Shell command. Edit one selected object in memory,
   compare SDK/CLI output bytes and every decoded part, and independently inspect
   the changed XML attributes and extension. Leave cached input unchanged.
4. Capture actual Shell accessibility help and an invalid decorative value using
   the maintained terminal screenshot utility. Inspect the PNG for legibility
   and clipping. This is terminal QA, not a presentation rendering assessment.
5. Record results here. Convert any meaningful product finding to a small original
   regression. Do not stage screenshots, corpus bytes or temporary QA artifacts.
6. Stage only named owned files and owned hunks in shared files. Review the index
   against the initial dirty-work snapshot, then commit locally on main using
   Conventional Commits. Do not push or release.

## Evidence boundary

Structural checks do not certify accessibility, visual reading order, contrast
or assistive-technology behavior. Whole public object-model parity remains a
separate incomplete obligation in the research inventories.

## Results

- Baseline maintained `npm run lint --workspace=pptx` passed before new source
  was present. Final checks must be repeated after integration.
- Initial command tests reproduced unsupported operations before wiring. Review
  regressions reproduced inherited title-type omission, unscoped title reports,
  unusable advertised shared scope, padded XML boolean rejection, stale returned
  mutation tokens and mutable caller options during asynchronous admission.
  All were corrected with original memory-only cases. Existing duplicate-layout
  rejection was confirmed rather than replaced with a different error category.
- Final `npm run test --workspace=pptx` passed all 4,266 tests in 169 files
  (55.80 seconds), including 29 domain and six command accessibility cases.
  `npm run lint --workspace=pptx` passed. The selected maintained
  `npm run build:workspaces -- --workspace=pptx` closure passed all three builds.
- Actual Shell tests for accessibility, links, image inventory, notes and modern
  comments passed all 23 cases after the final build. The two accessibility
  cases use virtual scripts, memfs publication and public SDK imports.
  Focused ESLint on accessibility/notes/modern-comment adapter tests passed.
  The exact integration registration guard passed all 107 cases.
- `npm run typecheck --workspace=virtual-bash` initially found fixture Map byte
  types and nullable property assertions in notes/comment tests. The separate
  [test-type correction](pptx-test-input-types.md) restored the maintained check:
  source/tests and all 26 consumer groups passed. Expected negative compile cases
  retained their failure statuses. These are compile checks, not consumer runtime
  certification. The unrelated fixture correction was committed separately as
  `1aeff00ce`.
- Disposable QA admitted the manifest's first cached deck only after checking
  1,202,514 bytes and SHA-256
  `885e923f148cdf4680372abe54496c824ab3a2a2d8a59fd9703d66e0aeb1164c`.
  SDK and Shell slide-1 inventory agreed. An original description, metadata title
  and explicit decorative false were assigned to object 3. SDK and CLI output
  matched byte-for-byte: 1,202,642 bytes, SHA-256
  `eff5e061ea49ca89552767ef494084bde17c908f9c329341e43ba2775fe969d5`.
  All 38 decoded parts were compared; only `/ppt/slides/slide1.xml` changed.
  Independent Saxes assertions confirmed `descr`, `title` and decorative `val=0`.
  The cached input hash remained unchanged; output stayed in memory. No download
  or fixture asset was added to the product or tests.
- `/tmp/pptx-accessibility-help.png` was captured using maintained `npm run
  screenshot` with an inline driver invoking the actual injected Shell command.
  The standalone virtual command uses this route rather than the root poe-code
  executable wrapper. The PNG was visually inspected: full help and the invalid
  decorative-value error are legible and unclipped, with statuses 0 and 2.
  This verifies terminal presentation only; no slide-rendering claim is made.
- Checks ran against the working tree while preserving existing image/media
  changes. Only owned accessibility hunks in the shared engine, exports and
  registration file are staged, using a diff against the initial dirty snapshot.
  Whole API parity remains incomplete: focused research retains 49 nearby unit
  variants, 24 BDD scenarios and 103 live API members as outstanding obligations,
  with 37 original accessibility cases accounted separately.
