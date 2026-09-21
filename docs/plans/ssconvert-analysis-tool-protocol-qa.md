# Hidden analysis tool protocol QA

Root owns integration, exports and Git. Do not push, publish or edit READMEs.
Primary source stays in `out`; native ssconvert is a separate QA oracle only.

1. Authenticate the retained official Gnumeric 1.12.61 archive against SHA-256
   `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
2. Use the existing explicitly selected colima `ssconvert-statistics-qa` oracle,
   with its own source-built prefix. Capture binary/library identity, dependencies,
   locale/environment and plugin listing. Never introduce a product native call.
3. Inventory all writable properties, inherited properties, class initialization
   defaults, constraints, enum nick/value mappings and exact output sheet names.
   Cross-check native introspection against the authenticated source. Record
   helper initialization diagnostics separately rather than counting them as passes.
4. Run original small CSV cases through the oracle. Preserve argv, status,
   stdout, stderr and output workbook bytes independently. Exercise first-colon
   splitting, duplicate replacement, malformed/unknown/empty names, enum parsing,
   case-sensitive Booleans, C number coercion and unused arguments.
5. Reproduce validated behaviors with in-memory codecs and memfs. Unit tests
   never run native programs or write host files. Cover cancellation, budgets,
   destination preservation and shared CLI/SDK behavior.
6. After implementation, assign a different agent to stress/fix owned analysis
   files and add concrete failing regressions before repairs. Root retains
   integration, export and Git ownership. Record remaining mismatches honestly.
7. Run maintained uncached workspace build/unit routes and focused package lint,
   plus the Safe Bash integration checks covering the virtual command. Inspect
   an ad hoc diagnostic screenshot when CLI output changes.

## Verified coverage and remaining mismatches

The final working candidate passed the uncached maintained ssconvert workspace
build closure, all 5,912 package tests in 290 files, and package lint (ESLint,
production/test TypeScript). The narrow Safe Bash integration cohort passed all
66 tests and its focused ESLint check. Repository-local Git hook variables were
cleared only in the unit child shell. The final diagnostic/CSV screenshot was
viewed. No test assertions or timeouts were weakened.

The official archive hash was verified, and all 41 inspected primary source
files match its bytes. The permanent profile is
`docs/ssconvert/analysis-tool-profile.json`: it retains dependency/library/image
identities, actual C locale and plugin activation, 31 class definitions with 154
writable properties (including inherited defaults, bounds and enum nick/value
mappings), 25 native CLI cases and the additional native numeric setter probes.
Capture channels and generated workbooks retain reversible bytes and hashes.
The independent agent's 27 stress cases comprise 16 protocol and 11 runner cases.
Root's nine protocol cases cover shared SDK/CLI behavior, real CSV output,
destination preservation, owned SDK setup, property budgets and failure status.
Safe Bash verifies actual CLI/SDK bytes, replay sheet names and namespace effects.

TDD reproduced the initial missing enum/default preparation and empty-tool
behavior, then validated repairs for setter flags, numeric conversion/diagnostic
bodies, cancellation, label-only ranges, detached-sheet admission/IDs, SDK-owned
nullable input setup, and generated-sheet focus. Native `dao_prepare_output`
focuses the generated sheet; the final CSV cohort matches its quoted header,
#N/A and averages 2/4/6. An earlier intermediate full check caught the active-sheet
assertion before its repair and a 5-second distribution-test timeout while source
archive verification competed for CPU. The final unchanged-timeout full route
ran after source verification finished and passed; no statistical code changed.
The readonly fixture TypeScript error was repaired with the same immutable data.

Numerical execution coverage is separate from protocol preparation. The default
runner supports basic simple moving averages; remaining tools require a trusted
injected analysis capability. Other moving-average modes 1-4, graphs and standard
errors are explicitly unsupported. These are remaining gaps, not passes.

Additional measured mismatches: native GLib prefixes/critical classification
include PID/time fields which the diagnostic channel does not match; the measured moving-average/data invocation with a nonexistent
selected sheet crashes native with status 139 while this engine rejects with 1;
label-header italic styling is absent in the built-in runner. Other output styles,
array/group metadata, named expressions, sheet-spanning/multidimensional ranges,
every property boundary transition and alternate libc/plugin/locale profiles
remain unqualified. Legacy raw capability properties are retained alongside
interpreted setup; injected numerical compatibility depends on honoring setup.

Working-tree code hashes and verified command receipts are in the permanent
profile. Temporary owned source helpers/logs/outputs are purged after reduction.
Existing archive/source trees and the shared oracle container are preserved.
READMEs remain untouched. No commits, pushes, publication or release occurred.
