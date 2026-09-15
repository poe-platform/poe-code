# DOCX schema and capability discovery evidence

Scope: `schema-capability-discovery` only, verified on 2026-09-15. Later
adaptation/model tasks remain pending. This is discovery evidence, not complete
format editing, source-test adaptation, rendering or public-model parity.

## Declared surface and support

The public SDK and SDK-backed command engine expose all 1,517 maintained
operation declarations. Root schema includes typed batch receivers, inherited
interfaces, enums, collections, helpers and public underscore-prefixed owners.
Unsupported declarations have `reject` support and failure-only result schemas;
their presence is not an implementation claim. Detailed help is generated from
the same declarations, including options, selection, scopes, limits, publication,
exit statuses and edit/read/preserve/reject distinctions.

Capabilities accounts for every F01–F50 requirement with bounded subsets and
reasons. With no input, detection remains null. With admitted bytes, the async
`inspectDocxCapabilities` SDK entry point reuses noncreating package inspection
and reports signed/protected constraints, unknown namespace URIs and unsupported
declared operations. Recognition and missing known tags never authorize editing.
Host guarantees require explicit capabilities and the corresponding methods;
admitted-byte inspection grants no path or publication authority.

The [execution register](discovery-coverage.json) links every command feature/API
row and every public API map row to usable schema/help operations and original
tests. Built public-export verification checked 15,764 schema/help links, matching support
and detailed help. The committed milestone reports packing as `reject`; separate
packing edits in the working tree are excluded.

## Exact language/security and drift boundaries

The pinned API and test inventories were read in full and their retained SHA-256
values verified: 920 API records, 1,609 unit variants and 650 expanded BDD cases.
They remain research denominators, not newly implemented or adapted cases.
The [reconciliation](upstream-api-reconciliation.md#language-and-security-decisions)
and command register retain the following distinctions:

| Contract | Discovery treatment |
| --- | --- |
| Neutral snake_case model members | Retained in typed declarations; CLI/operation options remain camelCase and mechanical kebab-case flags. No blanket aliases. |
| Async admission/publication; synchronous admitted model access | Input capabilities is always async and takes supplied bytes/context; missing live owners remain reject. |
| Zero-based model sequences, keyed lookup, iteration/at/slice | Remain individually declared, distinct from one-based CLI owner selectors; unsupported protocols are visible. |
| null/undefined/false/zero, checked units/enums/colors and UTC dates | Existing typed behavior remains separate from metadata discovery; recognition does not establish setters. |
| Owned Uint8Array and supplied VFS/time/author/metrics/cancellation | No ambient filesystem, native runtime, clock, fonts or network authority is acquired. |
| element/part and underscore-prefixed public interfaces | Bounded view obligations remain visible; unrestricted evaluation and host resources are not offered. |
| Documentation/source drift | D01–D23 dispositions remain intact: comment_id/timestamp, paragraph-owned add_run, table_direction, priority, enum aliases, per-axis DPI, UTC serialization and current/stale tab views. Typographical names do not create aliases. |

## Original failing tests and corrections

The retained initial red receipts cover omitted declarations/features, absent
input capability execution, incomplete result fields and empty feature links.
Resumption independently reproduced raw direction-control characters in human
namespace output and a pending command's emitted `unsupported-profile` missing
from its failure schema. Both regressions use original small memfs inputs and
assert unchanged authority/state. Human reports now escape the control while
JSON retains the exact namespace. Pending commands reject before input I/O.

Maintained tests also reproduced overlong removal help. Generated details and
capability prose now wrap to 140 columns, with separate original width evidence.
The exhaustive discovery test checks detailed help for every declared operation.

## Verification

Checks run against a detached snapshot of explicitly staged task content, with
packing/archive/math work excluded. The selected workspace build uses maintained
dependency declarations and the portable filesystem route.

- `npm run build:workspaces -- --workspace=docx`: passed.
- Focused discovery/removal/run-format verification: 68 tests passed in five files.
- Full DOCX unit and lint receipts: recorded after final settlement below.
- Built public SDK/export, inventory hash and exhaustive link checks: passed.
- `git diff --cached --check`: passed.

Ad hoc screenshots were generated with the maintained `npm run screenshot`
renderer against the built injected DOCX command. Reviewed text-replacement
help, no-input capability descriptions and the explicit denied-source JSON
failure. Descriptions wrap, option/selector/publication guidance remains visible,
and the source failure is redacted with exit 3 and null data. This embedded
command uses an explicit adapter; the screenshot adapter performs no host reads.
No screenshot tests, publisher files or cloned binaries were added. No document
renderer or visual document-fidelity pass is claimed.

QA procedure and ownership remain in
[the task plan](../plans/docx-schema-capability-discovery.md). Only owned task
content is committed on main; no push or release is authorized.

## Final settlement

The final task-only snapshot passed `npm test --workspace=docx -- --reporter=dot`:
156 files and 3,124 tests, no failures/skips (118.68 seconds). Maintained DOCX
lint and test/source typechecks passed with one unused-variable warning in
operation-types.test.ts; the selected workspace build closure passed again.
The final original output-budget regression failed with exit 4 before code and
passed afterward; selected JSON and human representations are bounded separately.
The command still bounds the complete emitted envelope. Focused live checks
passed 33 tests; independent read-only review passed 13 targeted tests and found
no functional blocker. Historical command-design hashes are explicitly labeled;
current discovery input hashes were independently checked against staged/HEAD
bytes. All 15,764 schema/help links resolve through public SDK exports with
matching declared support. Later tasks remain pending.

Retained receipt SHA-256 values (invocation-owned temporary files):

- `docx-discovery-task88-final-tests.log`: `5d8ec09b3f4baf0965cd12a8a78e92717175fa78107f8564d018cfe3fe9f9a36`
- `docx-discovery-task88-final-lint.log`: `e1fb8ec5c2f84605524d81968b0958e60c55bde059128e4366e8c75333541365`
- `docx-discovery-task88-final-build.log`: `6a1c8c8fbbfb9679c9b27a35ad7bed634e35e80b2b27e81ffc9523eaad92667a`
- `docx-discovery-output-budget-red.log`: `b0f21bba80c1100bcdc9f21b684fc22a16b8c7dcabe53bce85cef14d598619d3`
- `docx-discovery-output-budget-green.log`: `5e13f742d439f4855e46be16da8a33f2fa1de00e10608aef65bf942ec25f2977`
- `docx-discovery-owned-help-final.png`: `3fa59387a3df5f0efbaf82f7c0540d0a98b878bf61e0c3f59b2e1eeac19cf881`
- `docx-discovery-owned-capabilities.png`: `f89f35fe90b787a65b3843d2819c33ab9d724d337a6b41b1adfb9bdf7b5a7525`
- `docx-discovery-owned-error.png`: `f5c0fb51e9b0d4f01afea93231a8d9f78612693245d017efacdd134dda134024`
