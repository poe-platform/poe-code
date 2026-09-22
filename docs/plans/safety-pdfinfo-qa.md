# safety-pdfinfo candidate inspection and manual QA

Inspected 2026-09-21 at HEAD `ab1fa8d34101e1e7f61272973f3bc28a842043d8`
with the existing dirty working tree. This identifies an inspected checkout,
not an immutable qualified implementation. Unrelated edits were preserved.

## Executed inspection

- Source inventory (`rg --files packages`) contains no
  `packages/safe-bash-command-pdfinfo`, `packages/pdf-parser`, or
  `packages/safe-bash-pdf-parser`. Direct directory inventory confirmed absence.
- Searches of the root manifest, Safe Bash manifest and
  `scripts/bundle-safe-bash.mjs` found no pdfinfo/parser integration. Safe Bash
  command source inventory contains no pdfinfo facade; plugin tests and
  installed-consumer fixtures contain no pdfinfo qualification cases.
- [The parser plan](safe-bash-pdf-parser.md) keeps byte syntax, revisions,
  filters, page tree, security and private API implementation/test gates open.
  It explicitly requires prerequisite acceptance before dependent integration.
- The adjacent pdftotext command reports `extractionQualified: false` and rejects
  extraction with `Qualified PDF font/text/layout engine is unavailable`.
  It supplies no resolved metadata/page/security inspection API.
- `packages/pdf/README.md` describes PDF generation from layout blocks, not a
  qualified PDF inspection parser. It cannot discharge those prerequisites.
- The requested package-pattern path is absent following an existing move;
  [the archived pattern](archive/safe-bash-command-package-pattern.md) was read.
  It prohibits empty command scaffolds and requires installed runtime/type
  qualification of each real private command integration.

**Finding:** no candidate implementation exists against which to execute
safety-pdfinfo. The pdfinfo plan's prior engine/command `implement: done`
labels do not establish implementation or acceptance. Those unrelated edits
were preserved. No placeholder, duplicate parser, substring metadata reader,
native control execution, or fallback implementation was added.

## Pending runtime QA

Execute these steps against an implemented and qualified parser/command.
All cells below are **unexecuted**, not passes or optional skips. Unit fixtures
must use memory VFS/memfs and mocked capabilities; retain original minimized
fixtures and reproducible seeds for generated findings.

| Cell | Procedure and required evidence |
| --- | --- |
| Shell and SDK | Register the real opt-in plugin in a memory-VFS Shell; inspect identical bytes via a named file, chunked stdin pipeline, redirect and VFS `.sh` invocation. Compare SDK facts and exact CLI stdout/stderr/status. Keep SDK actual input length separate from CLI stdin file size zero. |
| Cancellation and disposal | Abort before acquisition, during incremental parse and while an awaited output write is blocked. Dispose during each phase. Verify cleanup settles, readers/writers and reservations are released, no further writes occur, and an independent later invocation succeeds. Inject acquisition, parse, write and close failures separately. |
| Invocation budgets | Exercise exact-limit and one-over input, retained/decoded bytes, objects, nesting, pages, traversal work and output limits, with several chunks/streams sharing one invocation budget. Verify rollback on rejected reservations and bounded failure diagnostics. Do not infer bounded performance from semantic test success. |
| Hostile PDFs | Use independently constructed cyclic page/structure trees, invalid references, malformed lengths/xrefs, truncated lexical strings, filter expansion bombs and unauthorized encryption. Require bounded rejection or explicitly qualified recovery; never infer document facts from substring matches. |
| Output publication | Resolve source/destination identity, hard/symlink aliases and same-file hazards before command-owned publication. Exercise exclusive creation and conditional replacement races, failed writes and rollback without recursive deletion or unbounded temporary storage. Separately test Shell redirection ownership: establish whether truncation precedes command entry and state the resulting guarantee. Ordinary stream output may be partial; claim atomic output only for a verified publication protocol. |
| Negative authority | Deny/mock host filesystem, process execution, network and ambient credential access. Include inert URI, JS, attachment and external metadata references; verify inspection never executes, fetches or extracts them and never chooses native/WASM/download fallback. |
| Independent compatibility | Compare exact bytes/status against the supplied pinned Poppler controls, including mode priority, omitted `-l`, dates under explicit locale/timezone, sorted custom keys, text-string encoding, raw metadata NUL truncation and preservation of full SDK metadata bytes. Supplied reference observations are not candidate passes. Language escapes, malformed UTF-8, output maps and unsupported security/codec variants remain open until exercised. |
| Packaging and realms | Build the maintained private workspace closure; install only public tarballs outside the checkout. Execute the public pdfinfo subpath and strict NodeNext declaration consumer with no private package installed. Verify runtime/declaration bundling and canonical contract identity. Run required actual realm and original/checkpoint/replay cells; Node-hosted graph checks alone do not qualify other runtimes. |
| Visible CLI | Execute the Markdown QA with `npm run screenshot-poe-code -- <command>` for affected visible CLI paths and inspect the screenshots. Confirm help/error and SDK options agree. |

After implementation, run the narrowest maintained workspace lint/test/build
routes covering it. Shared parser, contract or bundling changes require
`npm test`, repository-wide lint and `npm run build`. Record full failures,
timeouts, skips, unsupported variants and incomplete runs separately; a focused
rerun does not replace an incomplete broad gate. Temporary evidence belongs in
`/out` and must be purged after durable capture.

## Result

Static prerequisite inspection completed; runtime safety and compatibility
qualification remain incomplete. Runtime tests, syntax/type/lint/build gates,
screenshots, packed-consumer checks and replay/realm execution were not run:
the required command and parser are absent. No runtime pass, host-isolation
guarantee, resource bound or atomic-write guarantee is established.

Only this QA document was added. Local commits: none. Verified remote-main
delivery: none. Successful releases: none. No private package was published.
