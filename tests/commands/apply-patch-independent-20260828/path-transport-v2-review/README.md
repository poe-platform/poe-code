# Independent path-transport-v2 preparation — frozen before author inspection

August 28, 2026. This is the separately assigned independent preparation leaf.
Ownership is ONLY this new directory. No concurrent author's path-transport-v2
source was read or executed. No actual candidate/runtime GO is implied.

## Handoff

- **206 individually identified controls, all candidate outcomes NOT_RUN.**
  `CONTROLS.json` contains 155 raw-listing controls (including 98 historical
  identities), one UTF-8 profile refusal, one nonrecursive directory control,
  21 capture controls, 11 batch-body controls, two batch-request controls,
  four identity controls and 11 metadata/consumer recipes.
- `ACTUAL98.json` contains all 98 actual raw path identities as hex, original
  display spelling as base64, exact modes, object kinds and OIDs. No file bodies
  or instruction contents are copied. H001–H098 each have independently encoded
  tree bytes and OID expectations in `CONTROLS.json`.
- `SOURCE-INVENTORY.json` binds **12 historical source files and 19 historical
  plan/data files**, by path, size, filesystem mode and SHA256. The source scope
  and reachable sites are enumerated in `CONSUMERS.md`. It is not an inventory
  of the unread new author source, and not a full product/compiler inventory.
- `prepare-data.mjs` is a narrow independent DATA generator/reference, not a
  runner or substitute implementation. `PREPARATION.json` records its one
  successful preparation invocation: three serial development-Git metadata
  children, each limited to 10 seconds. The parent generator was also bounded
  to 10 seconds. The later apply_patch child ran serially, after generation.
- `PRESEAL.json` binds these owned files. The atomic preseal commit identity is
  reported externally, avoiding a self-referential embedded commit hash.

Root can launch the later reviewer with this preseal commit, the final exact
author commit and its exact seal, and a separately bounded DATA/SYNTHETIC grant.
Do not wait in a process; do not import/run the old controller or execute any
product, compiler, install, native oracle, network or actual runtime phase.

## What preparation actually established

The independent generator read preserved DATA and three Git metadata bodies:
raw `ls-tree -rz --full-tree` for product commit
`58be2d6c5706f3e90f01d48e695ecfd9daa52669`, that commit object, and its stored root
tree object. It did not load or save product blob contents from Git. It checked
the commit/object hashes, reconstructed all 50002 entries using its independent
reference, and compared the root payload bytes directly to the stored root tree.
The resulting root is `189bef24a927241d7c47a662f1ac447b56da1835`, not
`bd69c1a1dd0e65e442017ab27f86ed72a284fa95`.

Raw listing: 7695763 bytes, SHA256
`2648f28efa3a98f6d5dd4e1cd890001a2d287dfb0573304e11dbe61e58c6f689`.
Root payload: 449 bytes, SHA256
`c5b4e6fc1e54133ecb5851d12f87c04ae5ab56aa58134247dfd50bc81978a7e0`.
There are 4911 reference directories, including the root. Extraction of the
98-member holdout subset is separate from full-root reconstruction; no paths
were filtered from that reconstruction, including instruction path metadata.

The old human inventory was decoded ONLY to identify its 98 quoted paths and
cross-check every one of its 50002 records against newly obtained raw metadata.
C-unquoting is not a proposed repaired transport. The generator also consumed
the actual old persisted capture bodies, not just asserted receipt fields:
85 base stdout fragments (5554546 bytes), 38 object stdout fragments
(2475165 bytes), and 276 framed Git objects. It checked fragment bytes, channel,
offset, totals, sizes and both hashes, aggregate body hashes, object framing,
object digests and the actual candidate commit identity. Those object bodies
were retained transiently in memory only; no plaintext snapshots were created.
The old base root was independently reconstructed from its captured NUL body.

These are **preparation DATA facts**, not dynamic passes of the new repair,
not actual candidate acceptance, and not proof of the 8437 derived composition.
The original **25 DATA / 68 NOT_RUN** history and all failures remain immutable.
The generator did not invoke any old script. Its builtin imports are only its
own benign DATA tooling; no product, old harness or new author module import ran.
Interactive read/status/commit tooling is separate from its three metadata
children, not relabeled as controls or runtime observations.

## Independent canonical reference method

The concrete method and frozen positive outputs are in `prepare-data.mjs` and
`CONTROLS.json`. No author implementation is used to calculate expectations.

1. Scan raw NUL-delimited records as bytes. Split at the first header TAB only.
   The ASCII header has exact mode, kind and lowercase 40-hex SHA-1 OID fields;
   everything after the first TAB up to the record NUL is the path, unchanged.
   Empty input is an empty listing; an empty record is invalid. Require complete
   final framing. Do not trim, normalize, C-unquote, split lines or discard records.
2. Split path bytes only at byte 0x2f. Preserve whitespace, TAB, LF, CR, backslash,
   literal quote, non-ASCII bytes and case. Reject empty/dot/dot-dot components,
   absolute paths, NUL, duplicates and both directions of file/directory conflict.
   NFC and NFD names are different entries. Never create host paths from these
   holdouts. Path metadata may include AGENTS names; bodies remain prohibited.
3. Build a flat directory table keyed by hex components, then process deepest
   directories first. The independent implementation does not reuse the old
   recursive tree-hash or parser functions. Compare names byte-by-byte, with
   virtual terminator 0x2f for directories and 0x00 for other entries. No locale,
   JS string ordering, directories-first or whole-path ordering substitutes.
4. Serialize each directory entry as ASCII octal mode, space, raw basename,
   NUL, then the 20 raw OID bytes. Preserve 100644, 100755, 120000 and 160000;
   implied directory mode is 40000 (not ls-tree display 040000). A gitlink is a
   commit leaf, not a traversed directory. P30 separately freezes nonrecursive
   040000/tree metadata; recursive leaf inventories must not double-count it.
5. SHA-1 the exact `tree <decimal-byte-length>\0` header plus tree payload.
   Authenticate inputs first. A derived-only result requires no stored-object
   lookup; a claimed stored object requires actual body/type/digest evidence.
   D01/D02 retain the matrix's prior immutable T21/T22 distinction. Never turn
   failure of rev-parse for a derived-only identity into an admission failure.

P28 requires raw-byte preservation for invalid UTF-8. P29 requires rejection
when an explicitly strict UTF-8 string route is selected. This is not permission
to silently replace bytes or claim a string-only implementation covers arbitrary
Git byte paths. If the narrow repair supports only a declared strict UTF-8
domain, record P28 as unsupported, not passed; root decides the scope gap.

## Later candidate-review checklist

1. Authenticate exact final author commit/seal and this preseal from Git metadata;
   enumerate newly reachable source files without executing them. Preserve source
   hashes, exact export/call sites, authorization scope and before/after evidence.
   No default-to-HEAD, live overlay, historical rerun or runtime admission.
2. Map **every** consumer in `CONSUMERS.md` to repaired code or an explicit
   unreachable boundary. Retired admission/matrix scripts stay immutable; do not
   silently reintroduce their line/whitespace consumers through a new import.
3. Inspect actual capture invocation, raw return bytes, persisted body format,
   reassembly and parser usage. `-z` on a command alone, a helper unit result,
   expected-root stub or echoed success flag does not establish end-to-end repair.
   Do not extract a copied parser from source and call that the actual entrypoint.
4. Before execution, bind each frozen recipe to exact final DATA entrypoints.
   Keep payloads and expected outcomes unchanged. Synthetic capture `records`
   and `recordIndex` are fixture packaging for receipt plus fragment-file bodies,
   not invented required fields in the author's public schema. Adapt packaging
   only; preserve ordered fragments, both hashes, sizes, offsets and exact bytes.
5. Run H001–H098 through relevant reachable consumers, not just tree encoding;
   run D03 against the full 50002-entry listing and authenticated commit body.
   Cover selected-source capture as well as candidate/base inventory. Preserve
   exact path/mode/OID associations when different paths share a blob OID.
6. Exercise C01–C21 and B01–B13 against consumed bodies, including mutations with
   plausible asserted metadata. Re-sealed changed data still must fail when it
   conflicts with the authenticated parent commit/tree or selected source binding.
   The bodyless M10 stub must not earn a pass by repeating expected JSON.
7. Freeze actual execution call budget at handoff; children serial and <=10s.
   Use only DATA/SYNTHETIC/developmentGitmetadata. Do not start an old controller,
   build/import/install product, run native oracles, use network, or leave workers.
8. Report each control PASS/FAIL/NOT_RUN/UNSUPPORTED with observed output/evidence.
   Separate SOURCEONLY findings from dynamic observations. A negative control is
   satisfied only by rejection of its intended defect, not unrelated setup failure.
   Explain API/domain gaps and unreachable cases rather than reducing denominator.

The current output is preparation only. No dynamic pass, broad transport
qualification, product semantic pass, superiority or completion is claimed.
