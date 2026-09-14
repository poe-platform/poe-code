# Bounded DOCX styles and headings

Status: implemented and verified; local-only delivery, no push or release.

## Scope and ownership

Implement the requested paragraph, character and table style utility task only.
Keep later tasks, live object-model execution, latent-style mutation, numbering
creation and style deletion pending. Root owns the DOCX package changes and this
plan. The scoped safe-bash delegation policy was applied to independent command
integration and contract review; the existing adapter needed no source change.
Preserve unrelated working-tree changes and the preexisting main plan edits.
Do not push or release.

Product code remains in `packages/docx`. The original byte-admission, XML editor,
package graph, formatting serializers and publication path are reused. There is
no native reference runtime, downloaded fixture, product network, host font/clock
lookup or ambient product filesystem access. Test mutations use memfs.

## Behavior

- `styles list/get/add/set` inspect or edit exact named definitions.
- `styles defaults get/set` inspect or edit document run/paragraph defaults.
- Paragraph/character/table style IDs allocate deterministically without clashes.
- `base`, `next`, `linkedStyle`, `defaultForType` preserve relationship semantics.
  Linked paragraph/character pairs are reciprocal; rebinding clears prior paired
  edges. Self-next is valid; null next resets to self. Setting a default clears
  the prior default of that type. Invalid type relationships, missing references,
  base cycles and linked cycles longer than a reciprocal pair are diagnosed.
- The supported formatting subset is bold, italic, font, size, color,
  outline level, keep-with-next and before/after spacing. Definition inspection
  includes direct and inherited values, numbering references and raw retained
  run/paragraph/table metadata. Style bold/italic obey toggle inheritance; this
  is distinct from absolute run formatting. Sizes/spacing read in points.
- Edits preserve unedited source children, latent settings, theme parts, numbering
  and unrelated payloads. Unknown content remains subject to existing opaque-edit
  guards. No-op null resets do not publish a new styles part.
- Creation and `paragraphs add --level 0..9` share heading allocation. Level 0
  selects Title; 1–9 select outline levels 0–8. Built-in identities, types and
  outline semantics are checked, custom definitions are never overwritten, and
  generated collision variants are reused. New user-defined styles carry
  `customStyle=1`; a matching name alone does not qualify a heading.

## Exact language/security mappings and documentation drift

Read `docs/specs/docx.md`, shared office CLI/SDK contracts, the API audit and
style entries in `upstream-api-inventory.json`. The research source and historical
baseline remain in those research records. No reference names/assets were copied
into product code or tests.

Utility options are camelCase with mechanical kebab-case flags. These additive
utility operations are not the planned live model or dynamic method invocation.
The neutral model names `add_heading`, `add_style`, `base_style`,
`next_paragraph_style`, `style_id`, `quick_style` and `unhide_when_used` remain
unchanged in the model inventory. `Styles`/`LatentStyles` are name-keyed, with JS
`get`, `has`, `length` and iteration mappings; they are not ordinal/enum indexes.
The model's deprecated ID lookup is not implemented as a utility alias.

D05: `priority` is the spelling; base-style access applies to CharacterStyle and
its paragraph/table descendants, not every BaseStyle/numbering style.
D06/D07: exact names retain spaces; no ID-based naming algorithm.
D08: unknown assignment fails; dangling reads are diagnostic and may use defaults.
D22: defined boolean flags and nullable latent overrides have different reset
semantics. This task retains latent metadata; it does not implement the latent
object model or promote its pending inventory entries.

`undefined`/omission retains existing settings; permitted null removes direct
formatting/relationships. Explicit false stays distinguishable from absence.
Lengths are typed explicit emu/in/cm/mm/pt and use existing rounding rules; points
are returned for resolved size/spacing. Errors retain neutral typed categories,
common JSON and prepublication status behavior. Async supplied bytes/sinks/VFS,
limits and cancellation replace unrestricted I/O. No arbitrary evaluation,
Python dependency emulation or public underscore-name exclusion is introduced.

The direct link/default flags are an additive utility route. The separately
inventoried `styles.links.set` typed BaseStyle batch receiver remains pending,
as do `_TableStyle`, `_NumberingStyle`, `_LatentStyle`, inherited members, enums,
collections and general model execution. Neither source-test absence nor leading
underscores removes these from whole-public-API coverage obligations.

## Failing tests before code

- Original style tests failed against explicit unimplemented placeholders; the
  original creation suite's new conflicting Title/outline template failed its
  ID assertion before heading code changed (14 prior tests passed).
- CLI tests first reproduced unknown flags/unsupported style execution. Invalid
  style values then reproduced four pre-admission failures before schema checks.
- Further original regressions reproduced: missing defaults-part creation;
  incompatible base/link graphs and duplicate defaults; lost inherited namespace
  bindings in both dialects; repeat-default duplicate namespace declarations;
  paragraph heading rejection; new rPr/pPr order; a four-style linked cycle; and
  a null defaults reset unexpectedly materializing a part. Each was red before
  its corresponding fix and then passed.
- Original files/tests remain. New fixtures use original coastal wording and
  tiny independently authored XML. No download is required to run regressions.

## Manual QA plan

1. Run the maintained DOCX test/lint and selected DOCX build closure.
2. Run the existing safe-bash registration and portable export checks.
3. Through actual Shell with an explicit in-memory filesystem, create a document,
   add paragraph and character styles, pair/default them, set document defaults,
   insert Title, inspect/read back, and verify a cycle edit fails without output.
4. Capture actual help/result/error transcript with the maintained terminal PNG
   renderer and inspect the image. Artifacts are disposable QA evidence outside
   committed product/test inputs, not document-rendering or full model evidence.
5. Record results below, check owned diffs, stage explicit owned paths and commit
   the atomic bounded improvement on main. Report local hash separately; no push.

## Verification

- `npm test --workspace=docx`: **953/953 tests**, **40/40 files**, no skips.
  Final log: `/tmp/docx-styles-tests-final-20260914.log`. Earlier runs during
  incremental red/green work included the then-new failing cases; the final
  unchanged candidate run passed.
- `npm run lint --workspace=docx`: ESLint and production/test TypeScript passed.
- `npm run build:workspaces -- --workspace=docx`: maintained selected dependency
  closure and applicable lifecycle checks passed (five build tasks).
- From safe-bash: `node scripts/test-reporting.mjs --import tsx
  tests/commands/docx-registration.test.ts`: **10/10**, no skips.
- `npx vitest run scripts/docx-exports.test.ts`: **2/2**, including portable bundle.
- Nine actual Shell commands using the built SDK and explicit MemoryFileSystem
  passed with expected statuses. Built SDK readback confirmed reciprocal links,
  type default, 6pt document spacing and Title. The self-base edit failed with
  exit 1 and no publication. Transcript: `/tmp/docx-styles-shell-20260914.txt`.
- Generated help and actual shell transcript were captured using maintained
  `npm run screenshot -- --output ... --no-header cat ...`. Both original and
  110-column wrapped PNGs were inspected. Final readable captures:
  `/tmp/docx-styles-help-wrapped-20260914.png` and
  `/tmp/docx-styles-shell-wrapped-20260914.png`. Raw and wrapped transcripts are
  retained beside them. These are CLI screenshots, not document render evidence.
- `git diff --check`: passed. All unit mutation fixtures use memfs. No downloaded
  or ignored QA input is staged; unrelated plans/research stay outside the commit.

The single bounded feature commit includes implementation, regressions and these
plan/audit updates. Its local hash is reported in the delivery response. Remote
main delivery and release were neither attempted nor claimed. Later tasks remain
pending.
