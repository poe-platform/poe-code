# M1B independent execution: stopped, not accepted

Date: August 28, 2026

The single authorized review returned **FAIL** and stopped without retry.
This is a harness failure, not an established product defect. No product,
private, root-export or default-registration files were changed.

## Exact candidate and executor

- Product: `fca6f81d2d96db2bbceabf3247cd57ffe240bde6`;
  evidence `897e5141b034b59501f576a259d5ea1e7e2673c6`.
- Derived selected tree: `23074ef0c443ca618c4f26204b5f3d2274b86895`.
- Full 910-member archive:
  `cc0e75c2d0d12f713f0458e608ddeae157cf3432b4e0b48277a329a98115aa1a`.
- Executor seal: `64d76feb39275e4fa9d7e820c02eb48aaa68849b`;
  direct prelaunch review `7419015eaab74396c44015e061df7f10cd26251c`.
- Recipe SHA256:
  `a4c3fab089d7c2a957f4d263298a153b7cdea3d856c9820b5c90f6b0f2d591a6`.

## What actually completed

The runner authenticated **282 selected sources / 347 stored objects**, built
the selected source with the normal strict compiler, and admitted the complete
910-member package after offline installation with scripts disabled and a
physical move. Build and installation children returned zero; these are not
command/type-consumer passes. Twelve admission controls matched their expected
denials (**12/12 authentication-only**, zero product invocations; G07 exercised
mode, not the unrun symlink branch).

The first batch attempted `S:M1A-W1`. It escaped before the first fixture
observation, with **zero assertions and zero product-module loads**. The loader
trace contains five harness modules only. No virtual Git command or Shell
workflow ran. The supervisor stopped on
`SEM-S-01:M1A-W1:ESCAPING_SETUP_OR_ACTOR_FAILURE`; no later cohort ran.

The coordinator consequently retains **274 unfulfilled calls**: 208 stock,
32 private mechanical, 24 loaded controls, ten type fixtures. One setup attempt
failed; the other 273 calls never started. There are no semantic passes.
All **21 planned S01 calls** remain unfulfilled: 18 S/M private cases and the
three source-layout pristine/reversion/restoration calls. The 38-format,
32-resource/108-variant mappings, B01–B12 and six workflows are not runtime proof.
H09 remains unqualified and S02 remains SOURCE_CONCERN/UNRUN.

## Concrete harness defect and observation limit

`semantic/fixtures.mjs:213` decodes every neutral row with
`Buffer.from(row.base64, 'base64')`. Six unchanged neutral rows instead have
`text`: `.git/HEAD`, `.git/refs/heads/main`, `.git/config`, `README.md`,
`src/app.txt`, `notes.txt`. The required textual representation is therefore
not handled. This SOURCE contradiction precedes product loading and is
consistent with the captured stop. The escaping-worker record preserves only
the reason's type (`object`), not its message/code; an exact native error message
was **not observed** and is not invented here.

A future harness successor should validate the two explicit data encodings,
decode each without coercion, preserve every original fixture byte/expectation,
and capture bounded own-data exception details before stopping. No repair or
re-execution is performed under this consumed authorization.

## Retirement, evidence and limits

The supervised run recorded six processes including outer/coordinator, peak
three, no outstanding child and no capture failure. Routing and archive/cleanup
used one additional sequential process each; source-review metadata and Git
authoring operations remain separately identified preparation/evidence work,
not hidden runtime cases. Runtime accounting ended at **104,626.332251 ms**.
Capture charged **6,939,383 bytes**; reserved working files **418,513,801 bytes**.
No hard RSS or native-allocation claim follows.

Seventy-one exact raw/control/archive files were retained. A full 7,066-entry
before/after inventory matched; the owned 323,919,730-byte temporary tree was
removed and absence checked at **322,096.780125 ms from the original origin**,
within the same 7,200-second ceiling. Retained evidence is about 5.1 MB. No active
owned process or temporary-tree cleanup remains.

`actual-run/EVIDENCE-MANIFEST.json` SHA256:
`94b364f9950cd87361d7b3dda26646bbbbfdab028288e95c62163ae1e162f953`.
`actual-run/raw/000063-FINAL-RESULT.json` SHA256:
`68afcdd06d4147034c303f52f1101a4e19086503b83da9abe77f00df1f6b8cbb`.
`actual-run/CLEANUP.json` SHA256:
`41da6a9314030968f538b32398e5e5c4a57cf517aba60cb9bd7aab0853ce9dfc`.

Original 09029163/S01 findings, author 663/12, 699 and 744 results, old HOLDs,
and separate Dirac M1A evidence remain unchanged and are not inherited or
rescored. A corrected, freshly sealed successor needs new execution authority.
