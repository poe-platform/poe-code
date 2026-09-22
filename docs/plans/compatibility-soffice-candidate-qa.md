# soffice independent candidate qualification receipt

Executed 2026-09-20. Overall result: **incomplete; Office compatibility is not
qualified**. This receipt supplements, and does not replace, the acceptance corpus
and native matrix in [compatibility-soffice.md](compatibility-soffice.md).

## Candidate and controls

Base HEAD: `ab1fa8d34101e1e7f61272973f3bc28a842043d8`, with existing working-tree
edits preserved. The base revision alone does not identify this dirty candidate.
Package source digest: `d0a662c4d0891857a143eba8ad1ca61489c766d2a61c83e0d574ce62d3261834`.
Reproduce by sorting `packages/safe-bash-command-soffice/src/*.ts`, hashing each
package-relative pathname, NUL, exact file bytes, NUL, consecutively with SHA256.
Includes tests. This task added only `src/independent-controls.test.ts` and this
receipt; no engine code or shared build implementation was changed.

Source control: LibreOffice/core `d17755172ac96e54e3f10f35dd1b1680f0ef84bd`.
Installed manifest `26.8.0.3` is separate and is not a reported executable version.
Runtime: macOS 15.7.7 arm64, Node 22.22.2, npm 10.9.7, Python 3.9.6.
ESLint and TypeScript were invoked through workspace scripts and the current lock;
their independent version capture was not performed.

Manual native startup control used literal argv:
`["/Applications/LibreOffice.app/Contents/MacOS/soffice", "--version"]`.
Binary SHA256: `820ce37c7f7f496f73516d932109b1254463b33a993ceae0cfbaabac62f164bf`.
Python `subprocess.run(capture_output=True, timeout=10)` timed out; its direct
child was killed and awaited by Python. Captured stdout/stderr: zero bytes.
No normal exit status, reported Office version or conversion output was obtained.
No document/profile operand was supplied; filesystem/profile effects were not
audited. This attempt is a **blocked startup cell**, not a conversion result.
Earlier dyld failures remain separate historical evidence; this attempt does not
prove where startup stalled. No unrelated process was terminated.

## Markdown execution procedure and observed results

1. Read the current package, composition export, acceptance matrix and archived
   package pattern (the requested original pattern path was already moved in the
   working tree). Confirm private package name, ESM, empty runtime dependency map
   and composition-only safe-bash export. Passed static inspection; installed
   artifact delivery is a separate gate below.
2. Run `npm test --workspace=safe-bash-command-soffice`. Initial result: 61 passes,
   one failure in the new little-endian golden fixture: its final LF lacked the
   high zero byte. Inspect UTF-16 code units, correct the expected fixture without
   changing implementation, then repeat the entire package suite. Final result:
   **62 passes, zero failures/skips/cancellations**. No native spawn, fixture fetch
   or disk fixture creation occurs in these tests.
3. Run `npm run lint --workspace=safe-bash-command-soffice`. Passed ESLint and both
   production/test TypeScript checks.
4. Run `npm run build:workspaces -- --workspace=safe-bash-command-soffice --no-cache`.
   Passed the maintained dependency closure: safe-fs, contracts and soffice.
5. Run `node --import tsx --test packages/safe-bash/tests/plugins/soffice-wiring.test.ts`.
   Four passes, zero failures/skips. CLI/SDK conversion rejection, malformed byte
   argv, canonical runtime identity, opt-in registration, VFS scripts/redirects,
   denied host routes and mocked network authority passed. The shell itself opens
   redirects before command admission: redirecting to a source alias truncates it.
   Command rejection does not promise rollback of shell-owned redirects.
6. Execute the bounded native startup control above. Blocked. Do not run native
   macro/script-cat, listener, print or unsafe document operations.
7. Execute original document and exported screenshot comparisons only after native
   startup and original corpus prerequisites exist. **Not executed**: no Office
   conversion implementation, original geometry fixtures or accepted screenshots.
   No visible CLI change was made; this task did not renew CLI screenshot evidence.

## Exact added deterministic fixture set

Inputs are literal in the new test; no candidate exporter constructs the oracle.
The CSV options use independently specified token positions from the pinned Calc
export contract, not the distinct import contract.

| Cell | Input and expected effect | Output hex / SHA256 |
| --- | --- | --- |
| C1 plus CR/LF/inert formula edges | Rows `['name','value']`, `['a,b','x"y']`, `['A\rB','C\nD']`, `['=1+2','']`; absent export options; exact 42 bytes; no formula execution | `6e616d652c76616c75650a22612c62222c2278222279220a22410d42222c22430a44220a3d312b322c0a`; `f07e3035657b06752baeac8b4a5736742745ad1276b6a4ab9e4262c2fb8b89f5` |
| UTF16 big-endian | Row `['😀','é']`; `44,34,UTF16,1,,0,false,true,false,false,false,0,true,false,0`; 12 bytes including BOM | `feffd83dde00002c00e9000a`; `dd8c5fb0b1a42311d5f094805fb0a6791c200e76d24464a7c8f793a8ea2b29e7` |
| UTF16 little-endian negative control | Same row/options, last token `1`; 12 bytes, distinguish byte order | `fffe3dd800de2c00e9000a00`; `75035eda37d1579cc152ed69eb8a070b4d434a43188f331759c559f4587da5e1` |
| Selector/default controls | Literal options ending `true,2`, `false,-1,`, `true,1x,TRUE` after the first ten tokens; expect `(sheet,removeSpace,evaluateFormulas)` = `(2,true,true)`, `(-1,false,false)`, `(-23,true,false)` | No byte export or VFS effects |
| Late invalid text | Rows `['ok']`, `['\ud800']`; first yield 3 bytes, second rejects `invalid-argument`; retained row storage zero; stream then done | Prefix `6f6b0a`; `dc51b8c96c2d745df3bd5590d990230a482fd247123599548e0632fdbf97fc22` |

These controls establish bounded inert text behavior only. UTF16 is an explicit
product encoding, not a qualified native numeric charset mapping. LF output,
NUL/surrogate rejection and unsupported profile rejection remain product policy.
Previously yielded bytes are not transactional publication. No performance
benchmark or semantic claim based on elapsed test time is made.

## Open qualification cells

All native A01–A18, C01–C06 and F01–F06 conversion/status/effects variants remain
unqualified. Unsafe native A18 operations require source/inert inspection, not
execution. Original T/R/H/M/C document import/round-trip controls, W1–W6 multipage
text/tables/headers/footnotes, G1–G4 shaping/arithmetic, P1 presentations, S1/S2
spreadsheets, D1 PDF import and X1 hostile containers remain open. No original
DOCX/ODT/PPTX/ODP/XLSX/ODS fixture bytes or hashes were authored in this task.
There are zero accepted layout screenshots and zero native-qualified conversions.
PDF/A and PDF/UA standards checks were not run. All Office conversion filters
remain unsupported by the candidate; PDF existence/text equality cannot close them.

Node source execution passed; browser/workerd/worker runtime cells, isolated
installed runtime/declaration consumers, artifact dependency audit and original/
checkpoint/replay execution were not rerun. Existing build/consumer evidence is
not promoted to this candidate. Full `npm test`, repository lint and root build
were not run: this task adds focused tests/documentation and changes no shared
implementation. No broad gate is claimed from the focused suite.

No local commit, remote-main delivery, release or private-package publication was
performed. Conversion engine and independent native/layout controls are required
before compatibility completion.
