# Canonical differential corpus: current native generation

This supplements, and does not replace, the prior canonical procedure and blocked
profile. No README edits, push or publication are authorized. Native execution is
an explicit QA operation, never a product dependency or fallback.

## Execute and qualify

1. Verify the retained official archive in `out/ssconvert-lifecycle-oracle` has
   SHA-256 `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
2. Check Colima status and use the socket it reports. On this host the running
   QA container is reached with command-scoped
   `DOCKER_HOST=unix:///Users/kjopek/.colima/default/docker.sock`.
   Do not change global Docker configuration or overwrite the older blocked
   canonical profile. Absence of the runtime is blocked evidence.
3. Explicitly execute `/out/ssconvert-statistics-oracle/prefix/bin/ssconvert`
   inside `ssconvert-statistics-qa` with its prefix `LD_LIBRARY_PATH`. Verify
   version 1.12.61 and hash its executable, dependency closure, plugin modules
   and manifests, build configuration, fonts/resources, locale/timezone and
   settings schemas into a new exclusive profile under `out`.
4. For the settings-qualified profile use explicit `GSETTINGS_SCHEMA_DIR` pointing
   to the prefix schemas and `GSETTINGS_BACKEND=memory`. Retain the earlier
   configuration-warning captures; do not remove their warnings or timestamps.
   Optional solver programs, extra image loaders and other locales still require
   separate qualification. The captured base environment is not a complete
   runtime matrix.
5. Bind a new register to the new profile and retain its parent register hash.
   The reporter accepts an optional third argument for this register. Its default
   remains the previous frozen register. Never overwrite measured generations.

## Original command cases

1. Execute each original case spec under `out/ssconvert-canonical-current` using
   the native capture primitive copied there with a recorded hash. A copied tool
   is QA tooling, not a source fixture. Specs carry explicit `argv0` bytes for
   `ssconvert`, argv/stdin bytes, ordered environment, isolated cwd and profile.
2. Capture candidate execution with `runCommand` and `createEngine` from the
   built package. Inject byte sinks, cancellation and filesystem authority. Cases
   here exercise terminal/parser behavior; no importer/exporter correctness is
   inferred from an empty codec binding. Inject matching PWD for relative URI
   identity. Independently snapshot namespaces; do not reuse native snapshots as
   candidate observations.
3. Compare exact bytes and namespace order with the reporter. Inspect retained
   differences before changing profile or inputs. Using explicit argv0 avoids
   changing native text after execution. It is not an approved normalization.
4. Negative controls must reject blocked profiles, missing/forged input receipts,
   invalid environments/namespaces, omitted or changed argv0, NUL invocation names,
   profile member drift and self-comparisons. Leading BOM bytes must transmit
   intact, not disappear in decoding. Unit controls use memfs and mocked native
   process boundaries; they do not run a native utility or write disk fixtures.
5. Ten measured cases cannot qualify the complete 2,364-obligation register.
   Raw equal JSON does not qualify round-trip/interoperability procedures. Complete
   workbook snapshot producers, concrete function/importer/exporter/property cases,
   structured round trips and all runtime matrix cells remain required.

## Upstream research and verification

1. From the retained upstream extraction in `out`, explicitly run
   `t9001-ssconvert-resize.pl`, `t9005-ssconvert-merge.pl`,
   `t9006-ssconvert-split.pl`, and `t9007-ssconvert-sheet.pl` using the qualified
   settings environment. Record each status and its output separately. Licensed
   tests/assets remain in `out`; do not copy them into original unit fixtures.
2. Run maintained workspace build closure uncached, maintained workspace tests
   fresh, and workspace lint/typechecks. Run syntax checks for each `.mjs` tool.
   If integration/product/shared infrastructure is changed, expand the checks
   accordingly. A focused test rerun is not a completed workspace gate.
3. Have the independent agent stress/fix the resulting gates after implementation.
   Record the exact candidate file hashes, runtime hashes, QA capture hashes,
   passed/failed/blocked/unmeasured cases and outstanding procedural requirements.
   Source/profile hashes establish identity, not proof of full profile qualification.
4. No product CLI visual behavior is changed by this gate-only work. Native help
   text remains captured exactly; full product CLI screenshot/runtime integration
   qualification remains separate and unmeasured in this generation.
