# csvkit reference requalification QA

Research-only procedure; never invoke these native executables as product
fallbacks. Preserve root/scoped instructions, unrelated edits and staging. Do
not add README content, commit, push or publish.

1. Inspect repository state and existing reference documents. Reserve a unique
   owned directory under out for downloads, environments, captures and temporary
   extraction/inspection helpers. Helpers collect evidence; this markdown is
   the QA procedure.
2. Download the csvkit 2.2.0 PyPI source archive and verify the user-specified
   SHA-256 before extraction. Reject absolute/traversing/link members and bound
   each expanded regular file at 64 MiB. Recompute all 209 path/hash records and
   compare the existing source manifest exactly.
3. Verify the actual interpreter version and executable hash before accepting
   each profile. Do not trust an unversioned Homebrew or PATH binding. Create
   separate 3.9.6 and 3.14.2 venvs using the pinned interpreters and install the
   authenticated csvkit source plus the complete locked runtime closure.
4. Reconcile every active distribution version and its requirement metadata.
   Separate runtime requirements from installer and transient build tooling.
   Retain pip download reports, selected artifact URLs/hashes, full non-pyc
   installed file manifests and the exact canonical manifest hash definition.
   Freshly download source and selected-wheel artifacts; verify raw SHA-256 and
   match version-specific PyPI metadata before accepting provenance.
5. Use exactly PATH=/usr/bin:/bin, LC_ALL=C, LANG=C, TZ=UTC,
   PYTHONIOENCODING=utf-8, COLUMNS=80 and LINES=24. Supply empty piped stdin;
   independently capture stdout/stderr bytes and status, with bounded timeouts.
   For every independently expected original executable, capture --help, -V,
   --version and --csvkit-unknown-option. Compare all 112 existing observations
   exactly; never derive the expected executable list from the observed registry.
6. Capture --quoting 6 and --maxfieldsize invalid for all fourteen utilities.
   Preserve differences between suppressed-option and type/choice errors.
   Confirm all 56 statuses are 2. Capture csvcut --quoting 4/5 --columns 1 and
   csvformat --out-quoting 4/5 using the exact quoted a,b / 42,empty fixture in
   the reduced JSON. Confirm 3.14.2 accepts and 3.9.6 rejects those choices.
7. Introspect actual QUOTE_* constants, standard-library mixed-row CSV writes
   and reads, decimal context before/after imports, libmpdec, Unicode identity,
   OS/locale/timezone, UTF-8 mode, stream codecs/errors/buffering, warning
   filters, optional modules, dialect entry points and SQLite/compression
   versions. Distinguish builtin modules from extension files and OS install
   names from runtime library release versions. Inspect pinned dependency source
   to support each reduced claim. Record unknowns without treating them as passes.
8. Reduce provenance and captures to docs/csvkit, semantics to docs/specs and
   hash-pinned runtime requirements to docs/csvkit. Verify every retained
   manifest/file digest, the complete active closures and capture cardinalities.
   Check package/README/index state remains untouched. Preserve failures in
   reduced records, then purge only this run's owned scratch directory.

This does not qualify native operation parity, product commands, TTY behavior,
database services, optional installations or interactive interpreter sessions.
