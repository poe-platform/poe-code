# Post-source runner correction v2

Driver a9279a5a46d0c39a71e91bcb54bcb93def948a0b ran the exact source 102:
102 pass, zero failed/blocked/resource failures. Build and pack exited0. Its type
frontend failed with TS2353 at webdav.ts745 (`duplex` absent in RequestInit).
Complete original source result/load trace and stderr remain in raw/run-01;
RESULT.json records the interrupted orchestration. No provider source bug is
inferred from that frontend error, and it is not a negative-control kill.

Cause: types.mjs omitted `lib`, adding TypeScript's default DOM library, whereas
the unchanged baseline tsconfig.json explicitly selects ES2023 only. Node's
RequestInit includes duplex; the accidental DOM environment does not. The actual
baseline-config source build already succeeded. types-v2.mjs adds exactly
`lib: ["lib.es2023.d.ts"]`, preserving strict/exact-optional settings and all
original type assertions and ten targeted diagnostic inversions. Original types
driver and original seven precode files remain unchanged.

run-v2 reauthenticates the complete prepared-and-built source/artifact/tool state,
reuses the already built/packed exact artifact without another build, and repeats
source102 plus corrected types before continuing installed/moved102 and controls.
Repeated source results are separate runs, not summed or silently rescored.
No original expected outcome changes. This correction is after source inspection
and initial execution, not a precode freeze or source-policy amendment.
