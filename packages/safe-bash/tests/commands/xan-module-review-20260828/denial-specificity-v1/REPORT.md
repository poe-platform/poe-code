# Denial specificity and fifteen-case adjudication evidence

Friday, August 28, 2026. Bounded leaf review; only the new `tests/commands/xan-module-review-20260828/denial-specificity-v1/` namespace is owned. Artifact-only reading, hashing, JSON/archive decoding and documentation writes; no product execution/import/build/typecheck, native oracle, probe, retry, network, new dependencies, matcher run or rescore. No F11 reconciliation or mechanical-family implementation. Root retains adjudication authority.

## 1. Exact interruption evidence

The original log is 422,801 bytes / 5,735 newline-terminated lines, SHA-256
`67289f6a3b7b184b285f3b297082ad5982b693f1499c9fd717a2947f5ed06096`.
Path: `/tmp/xan-static-minimal-repros.UsFC5y/session.log`.

Its **exact denial text**, appearing identically at lines **5732 and 5733**, is:

```text
ERROR: This content was flagged for possible cybersecurity risk. If this seems wrong, try rephrasing your request. To get authorized for security work, join the Trusted Access for Cyber program: https://chatgpt.com/cyber
```

This is a quotation, not an instruction to rephrase, seek access, or retry.

- **Original complete user task request is present**, lines **13–32**. Its exact 6,737 bytes, including their terminating newline, are retained losslessly in `ORIGINAL-REQUEST.txt`, SHA-256 `253747e33b24988a80cb00e090d5e83b953462ef09d81667b45db1b4cc5eba5d`. This is the original task prompt, **not** a recovered rejected tool call or the complete provider/model request.
- **No exact rejected command, tool name, structured tool arguments, or backend request payload is recorded.** Do not reconstruct a run command from the prepared recipe or commentary. The log is a CLI transcript, not a complete provider protocol trace.
- The last of **22** emitted `exec` records begins at **5224**. Lines **5225–5231** show the shell request that stages explicit original-scope paths, checks whitespace, commits the preseal, prints HEAD and checks scoped status. Line **5232** says it succeeded in 345ms; line **5233** records commit `08dd69d0`, and line **5257** records its full hash. The exact rendered invocation is retained in `LOG-EXCERPTS.json`; it is a **successful preparation/commit request**, not the rejected request.
- At **5730**, the agent says: “Preseal committed. I’m starting the single bounded attempt.” At **5732–5733** the errors appear; only token accounting follows. There is no emitted tool call after that commentary and no product-start receipt in this tail. Intent is not issuance.
- The evidenced denial is **content-risk rejection at the model/request-processing interface as rendered by the CLI**, not a recorded command result. The log does not identify the exact flagged payload, internal enforcement component, safety rule, or denied operation scope. Calling it a rejected product shell command would invent missing data.
- **No OS permission denial is evidenced at this interruption**: no attempted command/process result, permission errno, or permission-denied text accompanies these errors. Header lines 6–7 state approval `never` and sandbox `danger-full-access`; they do not explain the safety decision. The earlier independent compiler failure is a different historical event, not the cause of these errors. No privilege/sandbox escalation is proposed.

`LOG-EXCERPTS.json` records byte offsets, lengths, hashes and exact text for bounded log segments; it also explicitly records unavailable fields as null/false. No full-log capture or replay was made. The original full model/provider request and any un-emitted proposed call remain **absent**, not reconstructed.

### Scope and safer bounded concept

Audit `06bfa5c918bf66ad36b106d4586d3dafa59f6f82`, `static-repros-interruption-v1/AUDIT.md`, SHA-256 `4695e51b71460be98ce40399f85b56a1e0547ce17dee81a7fa80c1d5834ee055`, reports no product-run issuance, no attempt-1 receipts and only historical synthetic qualification. Its process snapshots are historical; this reviewer performed no process probe. Available records do not establish activity outside their coverage.

Original preseal: `08dd69d06a2f40edd31263631605ae153a9cf318`; `PRE-SEAL.json` SHA-256 `fae62845e4754eadd1bb2b7c42ebe81e29f59484e8adef0dc0b0540bc993aa33`, authenticated here. It contains 14 cases, two layouts, attempt limit 1 and zero candidate executions before seal. **All 28 planned observations remain UNEXECUTED. SA-01/02/03 remain STATIC_ONLY**, not runtime passes/failures/timeouts. Their exact prepared IDs are retained in `LOG-EXCERPTS.json`.

Materially safer next method, **concept only**: root may resolve the diagnostic-policy question using authenticated existing artifacts and request clarification about the missing denial payload/scope. That changes the work from executing candidate cancellation/resource workloads to static evidence review, with no candidate invocation, resource stress or alternate executor. It does not evade the rejection, recover missing runtime proof, authorize a retry, or resolve the three static claims. No new candidate call is proposed here.

## 2. Fifteen held cases, both layouts

**Evidence for root adjudication only; no new expectation, acceptance or classification policy.** These are the exact 15 IDs per layout in sealed diagnosis `DIAGNOSTIC_SPECIFICITY_HOLD`, not the separate 10 wording equivalents. Each row below applies to SOURCE and INSTALLED_MOVED. All 30 original bound RAW_OBSERVATION and CASE lines were authenticated against the immutable archive, and all 15 diagnostic byte pairs were compared equal. All exact argv arrays also match both archived job rows. RAW_OBSERVATION itself lacks argv: job pointers, not a guessed command reconstruction, supply that binding.

Arguments below are literal JSON arrays (the registered command is `xan`; argv begins with its subcommand). Quotes, spaces, empty strings and `--` are not shell-normalized. No held argv contains an empty-string or whitespace-only operand; the separate wording-equivalent space case retains `" "` in `CASE-EVIDENCE.json`. Diagnostic strings include their exact trailing `\n`.

| Exact case ID (each layout) | Exact argv JSON | Frozen semantic condition / phase | Actual diagnostic JSON (SOURCE = MOVED bytes) |
| --- | --- | --- | --- |
| `X4-S01/P0` | `["select","--","0,,1"]` | S: interior empty clause; before I/O [V4 /cases/21] | `"xan select: unsupported in bounded CSV profile: selector syntax\n"` |
| `X4-S02/P0` | `["select","--","0::1"]` | S: repeated unquoted range colon; before I/O [V4 /cases/22] | `"xan select: unsupported in bounded CSV profile: selector syntax\n"` |
| `X4-S03/P0` | `["select","--","a*:0"]` | S: prefix branch followed by colon; before I/O [V4 /cases/23] | `"xan select: unsupported in bounded CSV profile: selector syntax\n"` |
| `X4-S04/P0` | `["select","--","*a[0]"]` | S: suffix branch followed by occurrence; before I/O [V4 /cases/24] | `"xan select: unsupported in bounded CSV profile: selector syntax\n"` |
| `X4-S05/P0` | `["select","--","\"a\"junk"]` | S: trailing junk after closing quote; before I/O [V4 /cases/25] | `"xan select: unsupported in bounded CSV profile: selector syntax\n"` |
| `B01-R4-start-length/P0` | `["slice","-s","18446744073709551615","-l","1"]` | B01-R4: u64 start+len overflow; argument-derived, before output [B01 /rules/3/cases/0] | `"xan slice: unsigned arithmetic overflow\n"` |
| `B01-R4-index-one/P0` | `["slice","-i","18446744073709551615"]` | B01-R4: u64 index+1 overflow; argument-derived, before output [B01 /rules/3/cases/1] | `"xan slice: unsigned arithmetic overflow\n"` |
| `B01-R4-header-column/P0` | `["headers","-s","18446744073709551615"]` | B01-R4: u64 header-start+column overflow; header read required, before output [B01 /rules/3/cases/2] | `"xan headers: unsigned arithmetic overflow\n"` |
| `B01-R5-interior/P0` | `["select","0,,1"]` | B01-R5: interior empty clause; original pre-output row, V4 S timing applies [B01 /rules/4/cases/0] | `"xan select: unsupported in bounded CSV profile: selector syntax\n"` |
| `B01-R6-L-range/P0` | `["slice","-L","0","-l","0"]` | B01-R6: last + range conflict; before I/O [B01 /rules/5/cases/0] | `"xan slice: conflicting slice modes\n"` |
| `B01-R6-I-range/P0` | `["slice","-I","0","-s","1"]` | B01-R6: plural indices + range conflict; before I/O [B01 /rules/5/cases/1] | `"xan slice: conflicting slice modes\n"` |
| `B01-R6-L-I/P0` | `["slice","-L","0","-I","0"]` | B01-R6: last + plural indices conflict; before I/O [B01 /rules/5/cases/2] | `"xan slice: conflicting slice modes\n"` |
| `flag-4-B01-R6-L-range` | `["slice","--last=0","--len=0"]` | B01-R6: last + range conflict; before I/O [B01 /rules/5/cases/0; variant 4] | `"xan slice: conflicting slice modes\n"` |
| `flag-5-B01-R6-I-range` | `["slice","--indices=0","--start=1"]` | B01-R6: plural indices + range conflict; before I/O [B01 /rules/5/cases/1; variant 5] | `"xan slice: conflicting slice modes\n"` |
| `flag-6-B01-R6-L-I` | `["slice","-L0","-I0"]` | B01-R6: last + plural indices conflict; before I/O [B01 /rules/5/cases/2; variant 6] | `"xan slice: conflicting slice modes\n"` |

### Frozen authority and specificity distinction

All V4/B01 references are read-only at freeze **`55810d4aea70fadf151c2fbf746a17f96bfeb599`**, under `tests/commands/xan-independent-20260828/`:

- **V4** means `SELECTOR-FREEZE-V4.json` and its exact `/cases/N` JSON pointer. `FINAL-CONTRACT-V4.md:39` gives the finite categories; lines **50–63** bind phase and diagnostics. **S** is syntax; **N** is occurrence numeric content/domain, both before metadata, input acquisition and result publication. **R** is resolution after the first logical record and before selected output, not a generic label for every rejected argument. Five held X4 rows are S; no held X4 row is N or R.
- **B01** means `B01-RATIFICATION-7.json` and the exact rule/case pointer. B01 rule IDs containing “R4/R5/R6” are not selector R-phase classes; those rows do not contain an S/N/R class field. The table preserves their actual arithmetic/conflict conditions and validation scopes. V4 contract lines **16–17** retain B01 while strengthening selector S/N timing; the R5 interior-empty case overlaps X4-S01. Header-column overflow explicitly requires header input and must not be relabeled before-I/O.
- The freeze requires identifying the failing syntax/occurrence/resolution condition, with the existing unsupported-family fragment for newly excluded cursor forms; it does **not** prescribe a new complete stderr string. B01 `/rejection/stderr` requires a bounded diagnostic identifying the rejected argument/condition with NONEXACT wording. Whether the actual generic **selector syntax**, **unsigned arithmetic overflow**, and **conflicting slice modes** categories sufficiently identify the frozen specific condition is the held root question.
- Original matcher predicates require more contextual specificity: empty clause; repeated colon; prefix/colon; suffix/occurrence; quote/trailing junk; the particular overflowing operands; or both conflicting modes. They are preserved as historical verifier evidence, **not elevated here into new normative expectations**. `CASE-EVIDENCE.json` binds their original source excerpt and the original failure for every row.
- **`-I` / `--indices` is plural-index mode; `-i` / `--index` is the single-index range form.** B01 `/rules/5/flagSets` and `rangeBinding` make this distinction explicit. R4-index-one uses lowercase `-i`; R6 plural conflicts use uppercase `-I` or `--indices`. Existing R7-invalid-plural and flag-7 are among the **10 wording equivalents**, with actual `Could not deserialize 'x' to u64 for '-I/--indices'.\n`; their plural label is correct, not an R6 mismatch.
- The ten already-classified equivalents are X4-R04/R05/R06/R07/R08 (each /P0), B01-R1-repeat/P0, B01-R3-space/P0, B01-R7-invalid-plural/P0, flag-3-B01-R1-repeat and flag-7-B01-R7-invalid-plural. Their authentic observations are separately bound in `CASE-EVIDENCE.json`. This review does not rerun corrections or claim those original FAILs became PASSes.
- A misleading label is evidence to clarify, not permission to silently recategorize. Diagnosis `POLICY_TENSION` / `DIAGNOSTIC_SPECIFICITY_HOLD` are triage labels, not a replacement frozen semantic class. Diagnostic matcher failure precedes later phase/cleanup assertions in `assertCase`; retained raw fields are not proof those unexecuted assertions passed. No change to status, bytes or phase acceptance is made here.

## 3. Immutable inputs, verification and preserved limits

- Candidate `0ec84fc38c3fafd75776d80148d4f3c2d77e6247` over base `5137a74ec855a32d8a8860eb66b62eb44d11e290`; original actual result `dad2b08ce6bba02d3c404e7a55da5f4163b39d77`. No current product bytes were loaded or executed.
- Final diagnosis `04fae50ae2ac224eba32cdb6ed84c43d2ee671ea`; `RESULT-SEAL.json` SHA-256 `1155f77cce223c78f8ca08b6f102e5a2348d7645fbb442da64f4018b4e7a0593`; all 22 inventory entries and exact committed namespace membership authenticated. `CASES.json` SHA-256 `a06d2279cebad1cd5806909918197cb73e2f94a3f5f10e7a6447b31791d0137b`.
- Original `CONTINUATION-EVIDENCE.jsonl.gz` SHA-256 `05619a20fc1ce8012b5dd3539b3e37a47070fb9c799b39d13248fdc8d44e88d8`, 23,229,158 compressed bytes. Read/decoded existing archive in memory; no archive extraction or new workload capture. Six selected raw files and six archived job files provide held-case bindings; whole raw-file hashes, exact observation/outcome line hashes, IDs, observation objects, original failures, job argv and frozen subtree hashes match.
- `CASE-EVIDENCE.json` supplies exact immutable archive paths, line numbers/hashes, lossless raw observation/outcome line text, archived job pointers and argv, frozen row pointers and subtree hashes, and the common diagnostic bytes. `SEAL.json` hashes this review's exact owned namespace excluding itself and records input identities. This is static artifact validation, not runtime or service acceptance.
- Original results stay **SOURCE 569/79/19, MOVED 570/79/18** (PASS/FAIL/BLOCKED, 667 each). **88 passing references per layout do not establish completion.** Original handoff lines 68–75 retain the initial **880 TS5033 compiler failure**, **two compiler attempts**, **one runtime cohort**, **zero candidate-case retries**; lines 94–95 retain **169/169 recorded children closed**. These are authenticated historical report statements, not newly executed checks or a present process snapshot.
- The separately versioned four mechanical families and **13 synthetic controls** are not repeated; F11 policy work belongs to the other `f11-reconciliation-v1` delegate. No superiority, full gate, whole-module acceptance or 72-hour-duration claim.

Stop after this bounded evidence handoff. All original artifacts, product/root files, AGENTS, foreign staging and native temporary artifacts remain untouched.
