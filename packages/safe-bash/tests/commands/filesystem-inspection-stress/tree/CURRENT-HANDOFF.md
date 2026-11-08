# Current independent tree handoff

Root accepts the bounded final replay of source commit
`436bda3e21b2b6041409fac7408cf072b5d3fe5e`: **31 raw passes, N16 accepted
profile/non-parity difference, 3 unsupported/not run, 3 characterizations/not
passes**. Native 20 remains **12 exact matches / 5 differences / 3 unsupported**.
This is neither an all-pass report nor full native parity or a full project gate.

Current replay evidence is in `evidence/final-436bda3/`; start with its `README.md`,
`final-replay-detail.txt`, `FINAL-MANIFEST.json` and `FINAL-RECEIPT.json`.
The independently owned **source-safety six-case gate remains separately pending**;
acceptance of this original38 replay does not execute or accept that gate.

## API boundary

The original38 uses the internal standalone module
`src/commands/tree/index.ts` via `createTreeCommand`. The separate typed build
consumer imports emitted `commands/tree/index.js`, typechecks all three factories
(`createTreeCommand`, `createTreeCommands`, `treeCommands`) and installs the
`treeCommands` plugin into actual Shell. These are standalone module checks, not
evidence of package-root/subpath exports, default registration or root integration.

## Preserved history

- Root `README.md`, `EVIDENCE-MANIFEST.json`, `PRESEAL-MANIFEST.json`, `sealed/`
  and `evidence/initial/` describe the older initial `e2d1b923` cohort. Its raw
  result is 30 pass / 2 fail / 3 unsupported / 3 characterizations. The original
  preseal and N18 regex failure remain unchanged; do not read that README as the
  latest handoff or edit it to replace historical facts.
- `corrections/n18-positive-depth/` retains the v1 correction and single fresh
  old-source invocation, including the subsequent peer HOLD and false accepts.
- `corrections/n18-positive-depth-v2/` retains the additive finite-profile helper,
  pure checks and offline evaluation only. Its historical pending-peer label is
  superseded by the completed independent report copied into final evidence,
  without changing the historical artifact or turning offline checks into runs.
- `evidence/final-436bda3/initial-results.json` is the **fresh final38** result;
  its filename is retained by the unchanged driver, not reused initial evidence.
  Original38 ran once on final source: 35 actual tree calls; the separate built
  smoke adds one. No native recapture or retry. N18 uses exactly peer-approved v2.

## External prerequisites

Root explicitly approved externalizing only `sealed/oracle/tree` and
`sealed/oracle/tree-2.2.1.tar.bz2`. Their exact bytes/modes are retained in fresh
independent `/tmp` regular files and in the unchanged original private sealed
copy; the repository contains the rest of the publication, **not all inputs**.

Read `EXTERNAL-ARTIFACTS.md` and `EXTERNAL-ARTIFACTS.json` for paths, hashes,
primary source/build provenance, availability limits and qualified recovery.
Old seals, manifests, READMEs and raw captures remain byte-identical. Their
pre-externalization full in-place verification statements are historical.
Legacy verification now requires restoring the two exact files at their original
relative paths in an **isolated copied corpus**, then running unchanged checks;
never skip missing inputs, rewrite expectations or restore binaries in this repo.

The additive `external-artifacts.mjs --verify` performs integrity checks only and
reports repository versus external coverage separately. Recovery is not a new
test/native/product run. No execution or broader gate is authorized by this index.
