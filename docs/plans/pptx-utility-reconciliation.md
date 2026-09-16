# PPTX utility reconciliation

Authority: root AGENTS.md, docs/specs/pptx.md, office-cli.md and office-sdk.md.
This task reconciles OPC, package, URI, serialization, image codecs and generic
XML utilities. It does not execute the overarching pipeline. Work stays on main;
only explicit owned paths are staged, with local atomic commits and no push.
Existing dirty files, README files and disposable fixture bytes remain untouched.

## Ownership

- OPC worker: package/URI/serializer and OPC XML tests, corresponding counterpart
  cases, focused original tests and opc-utility-reconciliation research receipts.
- XML worker: parser/namespaces/descriptors/simpletypes and counterpart utility
  cases, focused original tests and xml-utility-reconciliation receipts.
- Image worker: image codecs and counterpart utility cases, focused original
  tests and image-codec-reconciliation receipts.
- Root: evidence review, cross-family accounting, maintained package checks,
  disposable QA, explicit staging and commits.

Workers replace descriptor/mock topology with observable byte, graph, value,
error and publication assertions. Every selected parameter identity is retained.
Deliberate validation differences require a reason and passing original evidence;
open public behavior cannot be hidden by class naming or counted as parity.
Reference identities stay in research and standalone legal notices only.

## Verification and QA procedure

1. Run the maintained pptx workspace unit route for baseline and final changes.
2. Run focused worker tests, workspace lint, and the maintained selected workspace
   build closure. Review independent expectations and neutral test naming.
3. Verify source-row set equality and unique identities in each supplemental
   ledger against pinned test inventories, including counterpart utility rows.
4. Verify the first cached manifest document's SHA-256. Supply its bytes explicitly
   to the built SDK, inspect package/relationships/XML, save without edits, and
   compare preserved bytes. Use an explicit 16 MiB input/archive, 8 MiB member and 32 MiB expanded profile
   for this fixture, with model default XML/relationship limits.
   No fixture download, product network, native document runtime or fixture commit.
5. Where changed behavior is exposed, verify SDK and command paths. Inspect a
   screenshot only for CLI-visible changes. Reduce meaningful QA findings to tiny
   original in-memory regressions before fixing them.
6. Record actual results and remaining limitations, then commit each atomic owned
   improvement using the commit skill. Send the completion report through hey-boss.

## Final evidence

- Baseline: 6,347 cases/242 files passed. Final maintained workspace unit route:
  6,654 cases/250 files passed, including 307 new original cases.
- Maintained workspace lint and selected workspace build closure passed. Five
  actual safe-bash package-safety/image-density cases passed against final build.
- Combined ledgers cover 731 unique source identities: 316 presentation utility
  units, all 391 shared-package units and 24 BDD scenarios/examples. One MIME
  alias scenario is deliberately cross-referenced by two family ledgers.
- All selected unit ID sets equal their inventory selections; named target test
  references exist. Explicit divergences remain visible rather than promoted to
  literal runtime parity. The two unsupported EMF insertion scenarios remain
  supported rejection/preservation boundaries.
- TDD validated XML scalar failures; review added lexical whitespace and suffix
  boundary regressions. Exact image access review exposed and fixed an imported
  MIME alias failure that inventory preservation alone had missed.
- Final corpus QA matched the pinned hash, five slides, 23 ordinary parts,
  38 members and 34 relationships; all decoded member bytes remained unchanged.
  Deterministic ZIP ordering differs on no-op save and is recorded explicitly.
- Inspected `/tmp/pptx-utility-scalars.png` from the maintained screenshot route.
  No corpus/output package bytes, research checkout or screenshots are staged.
- Delivery consists of separate local XML fix, MIME alias fix, image accounting,
  OPC accounting and consolidated evidence commits. No push or release.

Local implementation/test commits:

- `e9ea017f2` — typed XML scalar parsing and 190-row reconciliation.
- `11c52338f` — validated imported JPEG MIME alias access.
- `390b034fa` — image-codec parameter and API reconciliation.
- `db317a96c` — OPC/package/URI/serializer/property reconciliation.

These hashes record local commits only. Remote-main delivery and release were
not attempted or claimed. The consolidated evidence update is a separate local
documentation commit.
