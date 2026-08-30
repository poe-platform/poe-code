# Final handoff and verifier-only correction

Candidate `0902f3c541c8e9a79771f55cb5c9b78c6b6eb09b`; no product edits.
The scoped recommendation and original results in `REPORT.md` / `REVIEW.json`
stand: **25/26 original runtime groups per source/moved layout**, **4/4 frozen
type families per layout**, **6/6 separate diagnostic controls per layout**.
Eight runtime weakenings, one declaration weakening and three loader violations
are rejected. No native WHICH runtime or public/default wiring is certified.

Only B18 remains red: the existing parser rejects `function-only()` before any
WHICH dispatch, status2 / `shell: Invalid function name at offset 13` plus LF.
The separately tested `function_only()` counterpart reaches WHICH and returns
the frozen intended status1 and `/a/tool` plus LF. The parser's restriction
predates WHICH. No WHICH module defect was demonstrated. Root may approve a
two-token, versioned B18 identifier correction; **none was applied**, and no
original failure or family was rescored.

## Evidence-reader correction, not a candidate correction

After sealing candidate results, `verify.mjs` failed at its line59 comparison.
Node22's TAP reporter escapes backslashes and hashes in diagnostic output.
The verifier decoded the embedded JSON directly, retaining a literal backslash+n
instead of the actual LF. The original captures, original reader and original
`REVIEW.json` remain immutable. This was a reviewer evidence-parser defect,
not a product failure, fixture amendment or changed output expectation.

`VERIFIER-CORRECTION.json` retains the old reader's exact hash and a reproduction
of its failed output, the pinned running Node builtin reporter's source hash/
escaping function, the exact one-line decoder delta and eight round-trip controls
(LF, literal backslash+n, hash, escaped hash, Unicode, tabs/CR, slash and empty).
It is explicit that the reproduction is not a saved capture of the first terminal
execution. Old-reader source and all its inputs are fully recoverable.

`verify-v2.mjs` reverses the single TAP escape layer **before** JSON decoding.
It retains every old hash/result assertion. It passes; no new candidate/native
execution accompanies the correction. This command supersedes only the final
verification command printed in the preserved `REPORT.md`:

```sh
node tests/commands/which-independent-20260827/review-0902/verify-v2.mjs
```

Original review JSON SHA-256:
`4f65894591578e608077007bc26bc3df252a39f7c08d13b36215ba2b3066740c`.
Corrected verifier SHA-256:
`0a614119d265a2efa32d3a322ad960ac467533fd306b774e60eb8698624d551a`.

Both owned scratch roots are removed; no matching child remains. All original
WHICH freeze/draft files and Stage2/R08v3 artifacts retain their hashes. This
handoff does not authorize runtime edits, change any cancellation policy or
represent the unintegrated module as a public/default command.
