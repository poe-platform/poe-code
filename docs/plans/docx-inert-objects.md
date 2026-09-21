# Bounded inert DOCX objects

Scope: F40 utility inventory, preservation and explicit extraction only. Later
tasks remain pending. Existing implementation and original tests are retained;
this task requalifies them and fixes missing incoming shared-descendant edges.

## Contract and implementation

`objects list` / `objects.list` and `objects extract` / `objects.extract` use the
same package engine through the existing safe-bash adapter. Inventory is global
unless explicitly selected; selectors retain fingerprint/stale-owner checks.
OLE and package payloads stay opaque, with exact byte lengths and SHA-256 hashes.
Preview association requires a unique matching stored shape ID. Descendant
graphs terminate on cycles and report incoming shared references for every
visited part, without recursively acquiring the other owners' graphs.

Extraction preserves occurrence order and writes `object-N.bin` plus a manifest
to an explicit canonical absolute VFS directory. Shared bytes may have repeated
occurrence entries. It preserves previews in the package, reports exact receipts,
and requires adapter transactions or explicit partial-output consent. Publication
preflights collisions, aliases, symlinks, exact total bytes and file counts,
including the manifest. Unrelated edits preserve object/workbook/preview bytes
and relationships. Missing internal targets remain invalid-package admission
errors; no missing bytes are fabricated.

## Exact JavaScript and security mappings

| Concept | Mapping and boundary |
| --- | --- |
| Input/output bytes | Async functions over admitted `Uint8Array`; explicit context limits and signal; no ambient host filesystem |
| Inventory | Read-only typed snapshot arrays; physical occurrence locations and shared owner arrays; no live embedding owner introduced |
| Selection | One-based CLI selectors and fingerprint tokens; utility options remain camelCase, including `outputDir` and `allowPartialOutput` |
| Resource identity | Original part names, content types, byte lengths and SHA-256; no embedded workbook decoding or object activation |
| External objects | Redacted target metadata only; no fetch, execution, host-app import or networking |
| Macro state | `declared` only for an explicitly macro-enabled embedded content type; otherwise `unknown`; outer macro-profile refusal retained |
| Protection | Outer stored protection reported as a boolean with no password/hash/salt values; embedded protection remains `unknown` |
| Unknown content | Opaque preserve-only carriers, unresolved binding warnings and incomplete extraction receipts; no confidential body dump |
| Extraction failure | Neutral usage, invalid-package, unsupported-profile, limit, publication and cancellation categories; truthful partial receipts |

The public API audit and pinned inventory were reviewed. There is no dedicated
embedding model owner in that inventory. Existing Part/XmlPart, Package/OpcPackage,
inherited members, collections, helpers, enums and documented underscore-prefixed
types retain their separate recorded obligations. Neutral model spellings are
unchanged. No historical inventory row is promoted, hidden or rewritten by this
utility regression; whole-public-API coverage is not claimed.

Documentation drift: the spec and API audit linked to this absent bounded record.
This record restores the link and records current utility evidence without
overwriting historical evidence or promoting later tasks.

## Failing tests before code and verification

- Added an original graph with OLE bytes, a shape-bound preview, a shared preview
  descendant, a cycle, an outside incoming owner and a credential-bearing external
  edge. The test first failed because the outside incoming edge was absent.
- Changed only the incoming-edge inclusion condition to use the visited graph.
  The original graph regression then passed, including bounded graph membership,
  cycle uniqueness and external-target redaction.
- Focused object SDK/command tests: 25 passed. Existing tests cover original
  embedded workbook archives, preview ownership, unrelated edit byte retention,
  missing targets, unknown/protected/macro reports, unsafe extraction paths,
  exact extraction totals/file counts and exact JSON stdout admission.
- `npm test --workspace=docx`: 247 files, 5,153 tests passed.
- `npm run lint --workspace=docx`: passed ESLint and source/test TypeScript
  checks (one warning in the unchanged operation-types test).
- `npm run build:workspaces -- --workspace=docx`: selected maintained dependency
  closure passed, five builds completed.
- `node --import tsx --test packages/safe-bash/tests/commands/docx-registration.test.ts`:
  all 16 existing registration, dispatch and VFS integration tests passed.

All mutation fixtures use memfs. No downloads, native reference build, product
networking, screenshot tests or ignored QA fixtures were introduced. Human CLI
formatting and command declarations are unchanged. Delivery is a local owned
Conventional Commit on main only; no push or release is authorized.
