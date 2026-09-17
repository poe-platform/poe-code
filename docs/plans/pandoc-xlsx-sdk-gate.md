# XLSX conversion adapter dependency gate

Status: blocked (2026-09-16). The `xlsx-conversion-adapter` task is incomplete.

A fresh discovery recheck covered 383 package manifests across all five local
checkouts and six lockfiles, including the parent Workspace. No sibling XLSX
SDK was found. Expanded evidence and the maintained test rerun are recorded in
the linked gate evidence; implementation and workbook QA remain pending.

No sibling TypeScript XLSX SDK with a public workbook-reading API was found in
the current workspace, its dependency lockfile, or the nearby repository package
manifests inspected in discovery. Do not implement a replacement workbook parser,
invent SDK imports, or activate XLSX support to bypass this dependency gate.

Discovery and verification evidence: [XLSX SDK gate](../pandoc/xlsx-sdk-gate.md).
This separate plan records this task without incorporating the unrelated pending
edits to `pandoc-typescript-safe-bash.md` into its commit.

## Resume procedure

1. Locate the delivered sibling SDK and read its actual public exports, scoped
   instructions, configuration, and workbook model. Confirm bounded ZIP/OPC input
   handling and that reading cannot recalculate formulas, execute macros, or fetch
   external workbook links. Missing APIs remain blockers.
2. Define the adapter's sheet order and explicit SDK selection controls, hidden and
   empty sheet policy, bounded used range, first-row headers, sheet captions,
   table construction, and merged-cell handling against that model. Distinguish
   displayed text from typed values and untrusted formula caches. Define errors or
   explicit loss diagnostics for distinctions the AST cannot preserve.
3. Write failing independent original tests before production changes. Cover
   sparse/high-coordinate sheets, merges, shared/inline strings, rich text,
   booleans/errors, 1900/1904 dates, leading zeroes, missing formula caches,
   multiple/empty/hidden sheets, and Unicode. Keep workbook mutations in memfs;
   unit tests cannot use external executables, downloaded fixtures, or LLMs.
4. Implement reading in `packages/pandoc` through the actual SDK only. Add CLI
   sheet options only through supported SDK controls, with SDK/CLI parity and a
   thin safe-bash adapter. Do not implement an XLSX writer.
5. Verify semantic tables with an independent workbook inspector as manual QA,
   record evidence under `docs/pandoc`, and run maintained checks for the changed
   scope. Validate any changed CLI presentation with screenshots. Advertise XLSX
   only after the complete gate passes.
6. Commit verified atomic changes on main with explicit task-owned file staging.
   Report local hashes; do not push or release without later authorization.

The requested workbook families and independent inspection have not been run:
there is no reader to exercise. Existing gate tests are not evidence of workbook
conversion correctness.
