# Unified76 policy v3 — component checkpoint, final driver HOLD

Root's new policy decisions supersede execution eligibility of86/0d7 drivers.
Neither old driver was activated. Product remains
`2ffcb23d6029250c48950030120ed0adad2e5769`, with the one approved extra count
hunk and the unchanged red unique-count assertion at line32. The separate
WHICH77 product284857d7 does not enter this gate.

## Implemented components, not an integrated launcher

`policy.mjs` is inert on import. Its pure parser accepts explicit `--run` only
for execution; `--execute`, missing mode/release/archive flags and unknown
candidate fail. `--inspect` is non-executing. The pure verdict requires exactly
one driver-managed production build, all declared phases, explicit expected
negative exits, complete positive TAP, zero fail/skip/TODO/cancel, bound inputs,
passed guards and clean/reaped lifecycle. A successful TAP cannot mask missing
bindings, cleanup failure, a killed child or missing phase. All34 component
controls pass on the actual Node24.11.1; these are not A01–A22 driver acceptance.

`built-consumers.mjs` provides an exact, versioned external runner transformation:
replace the selected runner's cold-dist assertion plus production-build call
with checks against the one authenticated emitted package receipt. Five import
specifiers are relocated to the actual immutable source's unchanged helpers.
Every consumer body, configuration, runtime count, permission/fallback check
and exact negative diagnostic remains byte-preserved. Twelve seam/transformation
controls pass, including stale/failed/duplicate build refusals. This component
does not itself prove execution of the23 strict/20 runtime/3 negative groups.
The final controller must authenticate the build receipt before handing it over;
the caller cannot self-certify mixed/stale dist by supplying arbitrary fields.

The new external-capture recipe uses `import.meta.main` for explicit entry. The
pinned primary API reference is Node24.11.1 ESM documentation, section
`import.meta.main` (`https://nodejs.org/download/release/v24.11.1/docs/api/esm.html#importmetamain`).
The eventual launcher must likewise remain inert under import, including spoofed
argv; no old top-level `run.mjs` is imported as an implementation shortcut.

## External identity observations and specific unresolved boundary

`external.mjs --capture` recorded whole readable origin trees before a future
staging/execution: main dependencies367 entries/48,179,371 logical bytes;
benchmark dependencies3889/75,292,558; npm2557/12,446,245; Xcode Git-core197/
16,319,360. Files are streamed/hash-bound with modes; symlink targets and their
file identities are recorded, not silently dereferenced into trusted directories.
The capture includes61 distinct file identities covering51 native assets plus
driver tools. Native assets include data as well as executables: this is not61
commands or51 behavioral successes. No dependency version-only admission suffices.

The trusted-host diagnostic observes macOS26.4.1/build25E253. Local `otool -L`
for Node24, Xcode Git and tar names system libraries whose declared paths are
not readable files, including `/usr/lib/libSystem.B.dylib` and `/usr/lib/libz.1.dylib`.
The ordinary `/System/Library/dyld/dyld_shared_cache_arm64e` path is absent too.
These observations do not authenticate OS-resident library bytes. Linkage was
sampled for these three tools, not exhaustively certified for all native tools
or Git helper interpreters. `bindingComplete:false` is deliberate.

Root must either explicitly qualify the trusted macOS kernel/loader/system-
library boundary while readable executable/dependency/helper bytes stay pinned,
or require additional executable/system linkage attestation. No such exception
is inferred. Under the current literal complete-linkage requirement, launch must
remain HOLD; this is not waived by native49+2 hash agreement.

## Remaining concrete integration work

1. Wire an actual import-inert `--run` entry to the reviewed engine; no ambient
   auto-run and no translation into old `--execute` semantics.
2. Admit/stage/recheck the frozen external trees, generated .bin wrappers, helper
   imports, executables and agreed linkage boundary before any suite. Reject
   missing/unbound origins78; the current capture is an observation, not release.
3. Replace unsafe whole-file hashes and setup stderr accumulation with streaming
   readers. Enforce before extraction the exact source path/type/link authority.
   Apply the declared finite source/archive/history/chunk/output/time limits to
   actual transports and supervised descendants, not only policy unit tests.
4. Reuse the single successful production build in the external current-consumer
   route. Record test-owned isolated builds separately without renaming a second
   driver production build as preflight.
5. Wire strict status/cleanup/skip policy into the real final process exit and
   stream canonical accounting. Retain raw failures; no green partial gate.
6. Seal the final source/tool/profile/package/cleanup packet for independent
   A01–A22 execution. Old34/12 component results do not substitute for that run.

Finite proposed values are executable policy constants: exact37,397 source
entries/2,382,440,287 bytes,3GiB archive transfer,8GiB history,1GiB dependency
tree,1MiB setup stderr,256MiB per-phase/4GiB aggregate output,64KiB chunks,
1MiB maximum parsed line,600s setup,1800s phase and5s cleanup. They are not yet
transport-enforced and are not RSS, arbitrary-child filesystem or opaque-host
preemption guarantees. The final driver remains unsealed; no full gate, private
engine or current-consumer runtime cohort ran in this checkpoint.
