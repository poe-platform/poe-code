# Opaque presentation resources

Scope: inventory and extract OLE objects, embedded packages, controls, web
extensions, font parts and 3D models as inert bytes. Preserve their OPC
relationship closure; reject imports whose object references cannot be remapped.
This task does not run the whole pipeline or implement the remaining live object
model and OLE creation requirements.

Authority: root AGENTS.md, packages/safe-bash/AGENTS.md, docs/specs/pptx.md,
docs/specs/office-cli.md and docs/specs/office-sdk.md. Existing unrelated edits
remain owned by their authors. Root owns only the opaque registration/export
hunks in command-engine.ts and index.ts and this integration plan.

Delegated ownership:

- Domain worker: new opaque resource module, original unit/import regressions,
  and domain plan.
- CLI worker: new opaque command/schema modules, SDK-command and safe-bash
  adapter tests, and CLI plan. Existing generic adapter remains the transport.
- Accounting worker: bounded case/API ledgers, research evidence and draft usage;
  corpus QA uses only manifest-listed disposable cached input.

Verification procedure:

1. Establish failing original tests before implementing each behavior.
2. Run focused domain, SDK-command and actual Shell adapter cases; assert exact
   payload bytes, closure metadata, active signals, safe extraction names,
   common JSON/flags/errors and unsupported import rejection independently.
3. Run maintained pptx workspace tests/lint and selected workspace build closure.
   Run the safe-bash maintained targeted reporter, test-discovery checks and
   guarded changed-file lint using the existing guard API.
4. Capture and inspect actual CLI help with the maintained screenshot route;
   keep images and corpus bytes under ignored .cache only.
5. Review case/API receipts for remaining public model gaps and explicit JS and
   security mappings. Do not infer whole-API coverage from operation coverage.
6. Commit each verified atomic improvement locally on main. Stage named owned
   files and only owned hunks in already-modified files. Do not push or release.

Validation results:

- Final maintained `npm run test --workspace=pptx`: 172 files, 4,303 tests
  passed. An earlier run loaded the output-count parser before its concurrent
  TDD fix and failed that new case; the focused rerun and fresh full run passed.
- `npm run lint --workspace=pptx`: passed ESLint and both source/test typechecks.
- Final `npm run build:workspaces -- --workspace=pptx`: passed the declared
  toolcraft-schema, office-package and pptx closure. Public declarations expose
  all three new SDK functions and their result types.
- Maintained safe-bash reporter with `--import tsx` and the exact new test:
  five cases passed, including actual VFS extraction and unsupported import.
  A first manual reporter invocation omitted the TS loader and failed resolution;
  rerunning with the maintained TypeScript loader passed.
- Maintained reporter's focused discovery and type-accounting cases: two passed.
- Guarded changed-file lint: both owned safe-bash test and discovery file passed
  with zero warnings/errors, all 25 receipts verified, 2,010 matched opens/closes,
  receiptsComplete true and failed false. The final expanded adapter test is
  checked again separately below; this is not a full-root lint claim.
- Inspected `.cache/pptx-corpus/opaque-command-help.png`: complete legible usage,
  explicit scopes, publication policy and opaque preservation boundaries.
- Manifested corpus QA matched both OLE payloads against independent ZIP bytes
  and SHA-256; see the accounting plan for exact identities and hashes.
- Case/API accounting retains 60 unit variants, eight BDD scenarios and 25 public
  members. Live model/creation obligations remain gaps, not covered by operation
  tests. No README, upstream asset or ignored QA fixture is staged.

Local delivery remains one atomic opaque-resource feature commit containing its
domain, command routes, adapter verification and evidence. No push or release.

Final adapter lint: SHA-256
`515d3392bd2f4ea086066ad639ba6f8452642645fe1ad62f12519e091dc78ed3`,
6,953 bytes, zero errors/warnings, 25 receipts, 2,009 matched opens/closes,
receiptsComplete true and failed false. Discovery-file lint SHA-256:
`b6fe571eedca9f53c933d1bb208e49f474cc477d9c447027624803cf71f23d7e`.
The working discovery file includes unrelated changes; only the exact new opaque
test inclusion is owned and staged.
