# EXPRPUBLICCOMPONENT: v3 stopped, no retry

Authorization label August 28, 2026; historical 20260827 paths remain unchanged.
Recipe: `56f550afee7e6fd895b6d700e4cec376b6cf1eaf`.

- Reader qualified **16/16** intended controls, including >4MiB streaming,
  size/hash/exit/type/mode/path rejection and closed-child supervision. The exact
  4,644,868-byte LAYOUTS and all **357** selected candidate inputs authenticated.
  Exact-sized JSON retention is disclosed; no constant-memory/RSS claim.
- The **one** independent build exited **2**, naturally and with its child closed:
  **832 TS5033** output-permission errors, 236,680 stdout bytes, empty stderr.
  The permitted `build/dist` directory exists but contains no files/directories.
  No pack invocation occurred. P01 **failed**; this is not a product semantic verdict.
- The permitted fallback authenticated and unpacked the exact **727,526-byte,
  834-member** authorpack, SHA-256
  `c109372f90b1bd19bcf756cf993bb2976fb52b75fe0c92a1cf96dab4c229b5cd`.
  Binding then failed **ENOENT**: sealed v3 `run.mjs:84` still reads v3 `cases.json`
  instead of the frozen legacy fixture. Original and installed fixtures exist.
  No fixture was copied and no runner/permission change was made after execution.
- Runtime: **0 pass / 0 fail / 104 unrun**; types **0/40 executed**;
  package controls **0**, runtime workers **0**, public load proof **none**.
  Wrapper exit 0 is not acceptance: the saved report records both blockers.
- All **2,295 reader/control Git/Node children** and the **one compiler child**
  closed. Source/build/copied-tool mode/hash/new-entry postchecks passed; the raw
  archive and all eight entries reauthenticated. These are not product passes.

Evidence manifest SHA-256:
`f2344a8bac78bf32599ba78b73eafa98e8102cf53976e5628b3d9bbf1b2af5c3`.
Evidence-seal SHA-256:
`03b306734d7ce62993b519810cd3d1de4931bfd6f27e35c2bfb977c79dcfef3c`.
`CHECKPOINT.json` preserves exact diagnostics, raw hashes, all unrun IDs and
supplemental read-only checks. V1 failures and the unqualified v2 remain unchanged.
Ignored `component-execution-v3/work/` is retained generated execution data, not
committed canonical test input; this review does not change canonical discovery.

**Next authorization needed:** a new presealed overlay with independently qualified
compiler-output handling and corrected fixture binding, before any further candidate
invocation. Do not weaken the permission fence, edit product code or retry v3.
Accepted-DU and the original gate remain **HELD/unrescored**. HTML is accepted
separately by root; no HTML, DU29, TAP or whole76/fullgate run occurred here.
