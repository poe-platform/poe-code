# Bounded settings and protection task

Scope: only `settings-and-protection` from the original TypeScript utility
pipeline. Later tasks remain pending. The pipeline file has unrelated work and
is deliberately preserved; this owned record supplies the bounded task update.

## Delivered behavior

- `settings list` and `inspectDocumentSettings(bytes, options, context)` share
  package logic and the existing operation ID. They inventory matching declared
  settings parts, including orphan definitions, without creating settings.
  Each immutable part snapshot has a source SHA-256 and zero-generation location,
  physical metadata paths, expanded names and stored attributes. Matching native
  compatibility metadata is read; unknown settings/foreign attributes are opaque.
- The stored nullable field-update and three font embedding flags preserve absent,
  explicit false and true. Missing, duplicated or unsupported boolean metadata
  returns null without inventing defaults. Password/hash/salt material is omitted
  from protection attributes; enforcement remains declared metadata, not verified
  rights or a password validation result. Embedded font resource definitions,
  keys, relationships and bytes retain the existing inert inventory and guards.
- There is no new typed settings setter. Explicit `xml set` of an existing
  settings part may change only admitted singleton boolean `updateFields` intent
  (including explicit absence). All other settings root/subtree bytes remain
  invariant. Compatibility, font embedding, unknown metadata, protection,
  unsupported field metadata and other affected settings changes refuse before
  publication. Existing math guards retain their more precise refusal locations.
  This does not execute fields or change per-field cached-result operations.
- Literal text replacement may edit ordinary text around byte-identical locked
  controls. A selected locked ancestor/content refuses even for unchanged text;
  baseline locked owners cannot be removed, changed or detached. Inherited XML/MCE
  and namespace context continue to be checked by the original admission guard.
  Other content editors retain their conservative refusal behavior.
- Original/candidate document protection remains fail-closed, including declared
  write protection, disabled or unrecognized enforcement, orphan settings and
  baseline removal. No authorization, exceptions-range editing, unlocking,
  password cracking, font installation, host font lookup or product networking
  is added. Inert custom XML spellings retain their existing unrelated-data role.

## Exact JS language/security mappings and documentation drift

The full 920-entry pinned API inventory was parsed; historical IDs, status rows,
source evidence and original tests are unchanged. Utility evidence does not
promote whole model coverage. Reference research identities stay in research and
this plan, never product source/comments/tests/fixtures/output.

| Public obligation | Exact JS/security disposition in this task |
| --- | --- |
| `Document.settings`, `DocumentPart.settings`, `SettingsPart.settings`, `Settings(element, parent)` | Live owner and creating-getter behavior remain pending. The utility returns an async readonly `SettingsListData` snapshot and never calls a creating getter. No alternate model method spelling is introduced. |
| `Settings.odd_and_even_pages_header_footer` | Neutral documented boolean property retains its planned live getter/setter obligation. Existing section utility policy remains separate; raw settings replacement does not add an alias or bypass its typed operation. |
| `Settings.element`, `Settings.part` | Public bounded XML/package views remain separately security-mapped obligations. Snapshot paths/expanded-name attributes expose neither unrestricted XML mutation nor ambient filesystem authority. |
| `Settings.__eq__`, `Settings.__ne__` | Explicit JS owner/value equality remains language-mapped and pending for a live Settings owner; snapshots do not establish wrapper identity parity. |
| `SettingsPart.blob`, `content_type`, `partname`, `package`, `element`, `part`, `related_parts`, `rels` | Inherited byte/package/XML and returned collections stay visible and security-mapped. Owned `Uint8Array`, neutral readonly metadata and snapshot locations do not establish live member or collection coverage. |
| `SettingsPart.load`, `load_rel`, `drop_rel`, `relate_to`, `part_related_by`, `target_ref`, `default`, `after_unmarshal`, `before_marshal` | Constructors, graph lifecycle, lookup/errors, relationship IDs and default creation stay separately security-mapped obligations. Async admitted bytes and explicit VFS publication replace host paths; no arbitrary factory/relationship invocation is enabled. |
| Font/ColorFormat, enums, helpers, collections and public underscore-prefixed owners | Retain their existing exact inventoried dispositions, including inherited members and APIs without source tests. No type is hidden based on an underscore prefix, and this utility does not complete their graph. |
| F42 utility metadata | `Promise<SettingsListData>` with readonly arrays, strings, numeric physical paths and boolean/null stored values; protection credentials excluded. JSON uses camelCase utility option/result names; no live property spelling migration. |
| Failure and authority | `UnsupportedEditError` / `unsupported-edit` is a package support refusal (exit 1). Invocation/schema misuse is `usage` (exit 2); source/host permission/publication errors remain distinct I/O categories (exit 3). Cancellation and invocation budgets remain enforced. |

Drift resolved: the former unsupported `settings.list` engine route now executes
and has closed result/help/schema coverage plus a specific F42 capability subset.
The former generic selected-read declaration incorrectly advertised selectors
which shared global-resource validation rejected. It now declares a global read
with only json/limit, and SDK options, generated help and input schema match.
Every story or part selector remains a usage error. No
settings batch execution, whole public model conformance or full-format claim is
made. The earlier section/theme/font records remain historical evidence.

## Original regression and QA evidence

Failing tests preceded product edits. Initial regressions reproduced the absent
SDK/command inventory, ordinary-text rejection around unchanged locks, and removal
of a baseline locked owner (six failures). Further failing original cases covered
raw compatibility/font setting mutation, stripping baseline document protection,
opaque native/foreign boolean metadata and missing human value output. Existing
test names/data and the original math/publication assertions are retained.
All mutation fixtures and output buffers use memfs; no downloads, reference build,
native reference execution or host document/font access was used.

The first maintained package test attempt recorded eight failures across four
files while the evolving patch was being completed. Its concrete findings were
resolved by preserving original math diagnostics, excluding package metadata
from part lookups, retaining original protected-error wording and extending the
original discovery inventories. It is not claimed as a passing gate.

Manual visual QA: run the package command engine with original in-memory settings,
inspect human inventory, operation help and protected-edit refusal. Capture those
outputs through `npm run screenshot -- --output /tmp/docx-settings-protection.png
--no-header node …` and inspect the PNG. The final inspected capture is
`/tmp/docx-settings-protection-final.png`; the initial screenshot exposed the
inapplicable selectors and was retained separately. This opt-in utility is not a root
poe-code subcommand, so the generic maintained screenshot route is appropriate.
The image and inline QA fixture are disposable and excluded from commits.

The [protected-region admission improvement](docx-protected-region-admission.md)
has its own owned atomic commit, `6a7800f7f`. Final maintained checks and local delivery are
recorded after completion below.
No push or release is authorized; later pipeline tasks remain pending.

## Final maintained verification

- `npm test --workspace=docx`: 140 files, 2,917 tests passed.
- `npm run lint --workspace=docx`: ESLint and source/test TypeScript passed;
  the one original type-only-unused-variable warning remains unchanged.
- `npm run build:workspaces -- --workspace=docx`: declared selected workspace
  build closure passed, including portable filesystem dependencies and maintained
  design export smoke checks. No native reference project build was performed.
- Final human inventory/help/protected-edit screenshot inspected; no selectors
  are advertised for global settings, and protected edits report exit 1.
- `git diff --check`: passed. Only owned files are staged explicitly; unrelated
  equations, pipeline and other plan work remains preserved.

Bounded task implementation/tests: complete. Whole public API, utility batches,
later tasks and full format certification: pending. Local commits only; no push
or release. Historical research and failed first-run evidence remain preserved.
