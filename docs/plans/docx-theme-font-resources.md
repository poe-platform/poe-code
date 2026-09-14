# DOCX theme and font resources

Scope: only `themes-and-font-resources`. Later pipeline tasks remain pending.
Baseline inspected: `facf5e836c96c3feb0953ca6ffbca2dc839ba306` on main.
The already-modified pipeline plan belongs to unrelated work and is not staged.

## Implementation evidence

Existing typed run/style setters already implement reference assignments. Five
original tests failed before implementation: four lacked detailed inventory;
XML replacement incorrectly published changed embedding metadata. Test harness
mistakes were corrected before recording these product failures. Later red cases
covered the result schema, prototype-name token validation, the generic CLI error
and the schema's `t1` color mapping. All corrections use existing command and
publication engines, without a second editor.

The additive `inspect.fontResources` result reports theme colors/fonts, font-table
entries, embedding/obfuscation metadata, language settings, color mappings and
unresolved references. Existing `fonts` fields remain unchanged. Null/omission
semantics of typed assignments remain intact. Missing resource diagnostics do
not synthesize resources or prohibit reference-preserving edits. Changes to
embedded definitions or bindings through XML replacement reject before publication.

## Exact language/security mappings and research reconciliation

Read the shared Office CLI/SDK contracts, DOCX spec, API audit and inventory
structure; reviewed ColorFormat, Font and enum entries against implementation
and the existing style-formatting case map. The pinned inventory is historical
research, not an execution ledger. No model row, inherited interface, helper,
enum or public underscore-prefixed type is removed or claimed complete here.

Reviewed retained ECMA-P1 schemas in `/tmp/docx-standards-20260913/ECMA-P1/schemas`:
`ST_Theme`, `CT_FontRel`, `ST_WmlColorSchemeIndex`, `CT_ColorSchemeMapping`.
The standards register maps F14 to P1 §17.7 / §20.1.6 and F42 to §17.8 / §17.15.
No native reference build, new download, font activation or product networking.
Fixtures contain small original XML and inert bytes in memfs.

| API / contract | Exact JavaScript mapping |
| --- | --- |
| `ColorFormat.theme_color` | Synchronous enum record or null; retained spelling. Model null removes direct color; utility `themeColor:null` removes only theme attributes. |
| `ColorFormat.rgb` / `.type` | RGB value object or null; read-only color type enum or null. No RGB evaluation of themes or tints. |
| `Font.name` | String or null; ascii/hAnsi assignment retains theme references. No availability/license claim. |
| `MSO_THEME_COLOR` / `MSO_THEME_COLOR_INDEX` | Existing documented alias and closed symbolic values; no numeric coercion or object-identity requirement. Setter sentinels reject. |
| Utility ThemeFont slots | asciiTheme/highAnsiTheme/eastAsiaTheme/complexScriptTheme map to w:asciiTheme/hAnsiTheme/eastAsiaTheme/cstheme; eight major/minor tokens or null. Omission retains state. |
| Inheritance | Direct model getters retain null; style inspection resolves the supported base/default cascade. Resource inventory lists stored references, not rendered script/font choices. |
| Inventory I/O | Always-async inspectDocument(bytes, context), mirrored by `docx inspect INPUT --json`; owned Uint8Array and explicit capabilities. Read snapshots, not live collections. |
| Reference checks | Closed typed tokens before input acquisition. Inventory distinguishes missing themes, invalid tokens, missing/ambiguous slots and invalid embedded bindings. Orphans/external targets do not satisfy references. Missing physical targets fail OPC admission. |
| Embedded mutation | UnsupportedEmbeddedFontMutationError extends UnsupportedEditError; code unsupported-edit, CLI exit 1, zero affected objects before output. Stored fontKey/subset flags are not decryption or licensing evidence. |
| Remaining surface | Existing bounded formatting element/part views retain ownership rules. General document/run/table bindings and unrelated API rows remain pending; no arbitrary evaluation or ambient I/O. |

## QA procedure

1. Run original resource regressions, maintained DOCX unit/lint checks and selected
   DOCX workspace build closure.
2. Run existing safe-bash DOCX registration/I/O/XML tests and portable exports.
3. Execute registered Shell commands with MemoryFileSystem: themed creation,
   typed reference set, inspect/help and invalid-token exit 2. Compare SDK inventory.
4. Capture actual command transcripts with the maintained screenshot renderer;
   inspect PNGs and keep all disposable QA artifacts outside Git.
5. Check the spec and owned diff, stage only owned files and this plan, then
   commit on main with a Conventional Commit. Do not push or release.

## Verification

An accidentally broad safe-bash
invocation ignored the attempted environment filter and was stopped; it is not
counted as a pass. Explicit existing DOCX test files cover the unchanged adapter.


Final maintained checks:

- `npm test --workspace=docx`: 1,405 tests in 53 files passed, including 15 new
  original resource cases; no skips. Final run 43.18 seconds.
- `npm run lint --workspace=docx`: ESLint and both TypeScript checks passed.
- `npm run build:workspaces -- --workspace=docx`: five selected tasks passed.
- Existing safe-bash DOCX registration/I/O/XML tests: 28 passed, no skips.
- `npx vitest run scripts/docx-exports.test.ts`: two portable export tests passed.
- Spec checker: zero errors/warnings. `git diff --check`: passed.

Registered Shell QA executed themed creation, in-place typed theme-font/color
assignment, human inspection and invalid-token exit 2. SDK inventory agreed with
published bytes. Maintained-renderer help and workflow screenshots were inspected:
`/tmp/docx-font-qa/help.png`, `workflow.png`, `workflow-direct.png`. The full
`npm run screenshot-poe-code` route completed its preparation and screenshot;
no generated QA assets are committed. The unchanged wrapper's preparation also
completed its workspace builds and root bundle, independently of the required
uncached selected DOCX build above.

The last additional red case verified case-insensitive MIME resolution and the
embedding protection boundary; all final checks include its correction. Original
resource definitions, unknown theme extensions and embedded bytes remain intact
through utility and live-model edits. No new model API completeness is claimed.

This is one interdependent inventory/preservation feature improvement, committed
with its tests, schema, command diagnostics and documentation. Owned files are
staged explicitly; unrelated work remains untouched. No push or release.
