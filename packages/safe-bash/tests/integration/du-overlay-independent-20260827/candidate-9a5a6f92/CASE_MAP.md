# Candidate case map

Candidate: `9a5a6f922beb1bc6ba84a0cd32ea7a12f8ce985d`

The original identifiers below are stable labels assigned to the unchanged
24-case harness order. The refined identifiers are emitted by the version-3
verifier. Counts in each suite overlap in subject matter and are not additive
claims about author coverage or a whole gate.

## Original unchanged harness

| ID | Kind | Exact harness name |
| --- | --- | --- |
| O01 | holdout | pending direct stat is pure |
| O02 | holdout | pending direct lstat is pure |
| O03 | holdout | pending direct readdir is pure |
| O04 | holdout | pending direct DU traversal is pure |
| O05 | holdout | pending readonly wrapper readdir is pure |
| O06 | holdout | pending readonly wrapper DU traversal is pure |
| O07 | holdout | pending mount over overlay readdir is pure |
| O08 | holdout | pending mount over overlay DU traversal is pure |
| O09 | holdout | pending overlay over mount readdir is pure |
| O10 | holdout | pending overlay over mount du is pure |
| O11 | holdout | metadata failure and retry preserve pending state |
| O12 | holdout | pre-aborted metadata read is pure |
| O13 | holdout | mid-traversal cancellation is pure |
| O14 | holdout | active stage remains hidden and queued readdir phase is pure |
| O15 | holdout | active stage remains hidden and queued du phase is pure |
| O16 | control | explicit cleanup remains a functional positive control |
| O17 | control | ordinary overlay mutation remains a functional positive control |
| O18 | control | ordinary content read remains a functional positive control |
| O19 | control | negative control kills readdir cleanup mutant |
| O20 | control | negative control kills DU content-read mutant |
| O21 | control | negative control kills DU copy-up mutant |
| O22 | holdout | invalid selected DU_BLOCK_SIZE falls back to no-env default |
| O23 | holdout | empty selected DU_BLOCK_SIZE falls back to no-env default |
| O24 | control | explicit -B remains strict and valid explicit precedence works |

The baseline RED set was exactly O03-O11 excluding O12, plus O13, O22, and
O23: ten upper-cleanup failures and two selected-environment failures. All 12
are green on the candidate. The five unaffected purity cases O01, O02, O12,
O14, and O15 remain green. Controls O16-O21 and O24 remain green.

## Refined-v3 execution of frozen-v2 targets

| ID | Kind | Exact harness name |
| --- | --- | --- |
| RV3-001 | holdout | direct stat refined-v2 metadata purity |
| RV3-002 | holdout | direct lstat refined-v2 metadata purity |
| RV3-003 | holdout | direct readdir refined-v2 metadata purity |
| RV3-004 | holdout | direct du-metadata refined-v2 metadata purity |
| RV3-005 | holdout | direct du-pending refined-v2 metadata purity |
| RV3-006 | holdout | readonly stat refined-v2 metadata purity |
| RV3-007 | holdout | readonly lstat refined-v2 metadata purity |
| RV3-008 | holdout | readonly readdir refined-v2 metadata purity |
| RV3-009 | holdout | readonly du-metadata refined-v2 metadata purity |
| RV3-010 | holdout | readonly du-pending refined-v2 metadata purity |
| RV3-011 | holdout | mount-over-overlay stat refined-v2 metadata purity |
| RV3-012 | holdout | mount-over-overlay lstat refined-v2 metadata purity |
| RV3-013 | holdout | mount-over-overlay readdir refined-v2 metadata purity |
| RV3-014 | holdout | mount-over-overlay du-metadata refined-v2 metadata purity |
| RV3-015 | holdout | mount-over-overlay du-pending refined-v2 metadata purity |
| RV3-016 | holdout | overlay-over-mount stat refined-v2 metadata purity |
| RV3-017 | holdout | overlay-over-mount lstat refined-v2 metadata purity |
| RV3-018 | holdout | overlay-over-mount readdir refined-v2 metadata purity |
| RV3-019 | holdout | overlay-over-mount du-metadata refined-v2 metadata purity |
| RV3-020 | holdout | exact child lstat EIO suppresses incomplete total and retry is pure |
| RV3-021 | holdout | exact v2 pre-abort reason is preserved |
| RV3-022 | holdout | exact v2 mid-traversal reason is preserved |
| RV3-023 | holdout | active mkdir-stage queues exactly one readdir read |
| RV3-024 | holdout | active mkdir-stage queues exactly one du read |
| RV3-025 | holdout | exact 1500-byte DU_BLOCK_SIZE table |
| RV3-026 | positive control | explicit cleanup removes the exact pending stage |
| RV3-027 | positive control | consumer-registered pending cleanup runs through actual Shell lifecycle |
| RV3-028 | positive control | normal mutation cleans pending garbage then publishes exact byte |
| RV3-029 | positive control | ordinary content read proves the content oracle |
| RV3-030 | negative control | unchanged purity assertions kill readdir-removal behavior mutant |
| RV3-031 | negative control | unchanged purity assertions kill content-read behavior mutant |
| RV3-032 | negative control | unchanged purity assertions kill copy-up behavior mutant |
| RV3-033 | holdout | actual Shell lifecycle runs DU registered cleanup and preserves caller reason |

RV3-001 through RV3-019 map the four exact compositions and their literal
operations. RV3-020 maps the exact child-path `EIO` plus same-fixture retry;
RV3-021, RV3-022, and RV3-033 map cancellation and lifecycle cleanup;
RV3-023 and RV3-024 map the paused post-creation stage-`mkdir` barriers;
RV3-025 maps all six rows of the exact environment table; and RV3-026 through
RV3-032 map the required discriminating controls.
