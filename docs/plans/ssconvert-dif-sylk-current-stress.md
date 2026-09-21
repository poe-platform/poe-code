# Independent current DIF/SYLK stress QA

Execute from the repository root. Preserve other work; do not push, publish,
edit README files, or use native utilities inside unit tests.

1. Read released Gnumeric 1.12.61 `plugins/dif/dif.c` under
   `out/ssconvert-lifecycle/gnumeric-1.12.61`. Confirm type-1 column overflow
   consumes the associated string and continues until a later BOT/EOD; numeric
   overflow stops before consuming the numeric marker. Check `cell.c`/`sheet.c`
   for rejected out-of-range coordinates. Do not infer libc hexadecimal parsing:
   the captured goffice `go-math.c` explicitly rejects hexadecimal numbers.
2. Run `npx vitest run packages/ssconvert/src/codecs/dif-sylk-stress.test.ts`
   before changing code. Original candidate produced two concrete failures:
   an overflowing string row lost the valid following row, and missing EOD
   returned a successful workbook instead of a data-read error.
3. After the narrow overflow fix, rerun that file together with
   `dif-sylk.test.ts` and `dif-sylk-independent.test.ts`. All fixtures are original
   small in-memory record strings. No filesystem mutations or native children.
   Verify recovery after BOT, EOF rejection, numeric-overflow termination,
   unknown numeric-marker column consumption, ignored bytes after EOD,
   cancelled readers/writers, input/output budgets, unknown SYLK records,
   escaped semicolons and canonical errors.
4. Run `npm run lint --workspace=@poe-code/ssconvert` for source lint plus source
   and test TypeScript checks. Root owns final maintained uncached package
   build/test/lint and Safe Bash CLI/SDK/realm/checkpoint/replay integration.
5. When the captured native reference runtime is available, compare the new
   wide-row fixtures through DIF-to-XML/CSV and cross-format round trips under
   the recorded dependency/plugin/C-locale profile. The local Docker socket
   is unavailable in this session: these new native comparisons remain
   unverified, not passes. Source review and deterministic unit checks are
   separate evidence. Capture any native assertion diagnostics for the first
   invalid coordinate rather than assuming only the final width warning.

Current independent receipt: six stress tests passed; all three selected codec
files passed together (36 tests). The two failing pre-fix cases were fixed after
their failing run. Native cross-format execution of these new fixtures, libc
`atoi` overflow behavior, assertion-diagnostic bytes at out-of-range coordinates,
the 65,536-row boundary, and bounded timing/memory measurements remain unverified.
This scoped review does not certify complete format parity or full repository
gates. The root agent records final workspace/integration results separately.
