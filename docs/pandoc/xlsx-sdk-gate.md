# XLSX SDK discovery evidence

Date: 2026-09-16. Result: dependency gate blocked; no conversion code changed.

## Inspected sources

- Root `AGENTS.md`; no scoped `AGENTS.md` was found under `packages/pandoc`,
  `packages/office-package`, or `docs`. No safe-bash files were changed.
- Root `package.json` declares `packages/*` workspaces. Parsing every current
  workspace package manifest found no XLSX/spreadsheet package or dependency.
- Parsing `package-lock.json` found no package keys containing `xlsx` or
  `spreadsheet`.
- The same package manifest inspection in nearby checkouts `poe-code`,
  `poe-code-3`, and `poe-code-4` found no XLSX/spreadsheet matches. Filename
  discovery found generated `.xlsx` documents and the converter descriptor,
  rather than a sibling TypeScript workbook SDK. Those documents were not used
  as fixtures. This is a local discovery result, not a claim about unpublished
  work elsewhere.
- `packages/office-package/package.json` exports the root, `./zip`, and
  `./compression`. Its `src/index.ts` exposes ZIP/compression codecs, limits,
  runtime types, and errors; it exposes no workbook or worksheet reader.
- `packages/pandoc/package.json` includes office-package, PDF, and PPTX
  dependencies but no XLSX SDK.

## Existing behavior

`packages/pandoc/src/formats/xlsx.ts` declares a read-only binary format but binds
no reader. In `src/formats.ts`, availability requires a bound reader, format
listing filters unavailable readers, and resolution raises `E_CAPABILITY` when
none is bound. The descriptor therefore does not advertise working XLSX input.
Writing is rejected. No sheet selection controls are defined or guessed.

Existing `src/delimited.test.ts` checks that XLSX reading rejects with
`E_CAPABILITY`; `src/formats.test.ts` checks that XLSX writing is rejected.
The maintained verification command is:

```sh
npm run test --workspace=@poe-code/pandoc
```

Result: exit 0; 37 test files and 956 tests passed. Its output is recorded in
`xlsx-sdk-gate-test.log`. This verifies the existing converter checks only; it
does not validate any XLSX workbook semantics. No code changes were made, so no
new failing implementation tests or code lint/build checks were required.

## Blocker

Implementation requires the real sibling SDK package and public APIs for bounded
workbook reading, sheet metadata/selection, sparse cells, merges, displayed text,
typed values, styles/date systems, and formula cache presence. Discovery supplied
none of these workbook APIs. No alternative parser, native runtime fallback,
writer, fabricated SDK contract, or passing workbook gate was added.

The resume/QA procedure is in
[the task plan](../plans/pandoc-xlsx-sdk-gate.md).
