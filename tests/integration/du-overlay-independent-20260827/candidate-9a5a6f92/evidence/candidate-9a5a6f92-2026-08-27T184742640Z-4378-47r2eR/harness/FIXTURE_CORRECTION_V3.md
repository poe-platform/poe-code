# Refined-v2 access-time observer correction

Date: 2026-08-27T18:44:04Z

The exact refined-v2 fixture was executed unchanged before this correction. Its
complete raw result is retained under
`evidence/refined-v2-frozen-atime-observer-fail/`. It reported 22 failures out
of 32 cases. Nineteen composition cases, the failure/retry case, and both
active-stage cases failed their full-stat snapshot equality check.

This is a verifier-fixture defect, not evidence that those actions issued a
hidden filesystem mutation. The mandated snapshots enumerate with public
`readdir` and read file bytes with public `readFile`. Candidate Memory updates
`atimeMs` for both operations. The verifier also performed its pre/post merged
visibility observations with public `readdir`. Consequently, even the direct
`stat` and `lstat` cases changed access times solely because the verifier
observed the fixture. The raw action-window records contained no forbidden
mutation or content calls for those cases.

The version-3 structural snapshot therefore omits only `atimeMs`. It continues
to compare deterministic namespace order, complete file bytes, type, size,
provider allocation when present, mode, modification/change/birth times,
identity scope, device, inode, link count, uid, and gid. Action-window counters
still reject every content read and every mutation method. Identity and actual
backing-entry comparison checks remain separate. This correction does not
rewrite the frozen document or the failed capture.

The same first run also exposed an expectation transcription error in the new
verifier: successful `du -b /holdout` legitimately emits the nested directory
record before the operand total. The refined freeze requires retry success; it
does not require a one-line retry output. Version 3 checks the exact two-line
output `4\t/holdout/sub\n39\t/holdout\n`. The failed raw result and original
assertion remain preserved.

Raw SHA-256:

- `run.stdout`: `3fa5f7e7cc3a1bb9133086b06c41ac4f671e562a62192d144e9c800dd9df5e14`
- `run.stderr`: `5fa997f91509e743cd70fb5fd20f5a6dffd35bc5e074e0cf8038ec235a4571fe`
- `run.status.json`: `93d7432ac47672a3e8d78119710975fa84c477a7db057947787cc24874586082`
- pre-correction verifier blob: `f127f231fe53392ed3635af1c255b66526b5c485`
