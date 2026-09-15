# ZIP compliance

## Objective and reference

Make safe-bash's ZIP command fully compliant. Use Info-ZIP 3.0's Unix CLI and
the ZIP format specification as behavioral references; preserve the virtual
filesystem and explicit resource/capability contracts. A passing subset does not
establish completion. Native compression bytes may vary by encoder, but archives
must interoperate and option effects, selection, metadata, diagnostics, statuses
and filesystem effects require direct evidence.

## Remaining work and acceptance

1. Complete argument grammar: long options, short groups and two-character options,
   negation, attached/separate values, list terminators, literal paths, ZIPOPT,
   usage/version/license/options output and diagnostic statuses.
2. Complete selection: stdin names (`-@`), source wildcard expansion, `-R`, `-nw`,
   `-ws`, include/exclude lists, date ranges and platform case behavior. Verify
   recursive paths, symlinks (`-y`), omitted directories (`-D`), source/output aliases,
   permissions, missing and unreadable files and quoted/raw filename bytes.
3. Complete archive operations: update/freshen, delete/copy, file synchronization,
   separate output, move, entry/archive comments, archive timestamps, suffix-based
   storage, metadata stripping/preservation, line-ending conversion and integrity
   testing. Verify unchanged payload preservation and publication failures.
4. Complete streaming: stdin members, stdout archives, default filter invocation,
   data descriptors, backpressure, cancellation and cleanup ownership.
5. Complete formats: ZIP64, supported compression methods, legacy encryption,
   split archives, self-extracting prefixes, adjustment, recovery and extra fields.
   Gather spec/oracle evidence before changing each format admission rule; no native
   executable fallback is permitted. Limits remain explicit rather than silently
   treating unsupported operations as successful.
6. Qualify interoperability, exact option/selection/status effects, binary data,
   Unicode and metadata with independent native captures and deterministic memory
   tests. Capture native oracles manually in isolated temporary directories;
   canonical unit tests neither invoke native tools nor create host files.
7. Deliver atomic commits on main with scoped verification and GitHub publication
   evidence. User requests continued implementation while releases run: inspect
   live release handles alongside work, without blocking progress on publication.

## Evidence already established

- `d7c6149d8`: `-j`; 203 scoped ZIP/unzip tests and lint passed. Scoped package
  publication succeeded as `@poe-platform/safe-bash@0.1.610`.
- `fa0d51bf1`: `-i`/`-x`, source-path filtering before `-j`, `@` terminators,
  excluded-input reads, existing-member preservation and empty inclusion behavior.
- `22066cd6a`: `-0` through `-9`, last-level precedence and zlib interoperability.
  These two improvements have been verified on remote main. Publication must be
  inspected independently; local delivery alone is not release evidence.

The maintained ZIP documentation currently explicitly lists format gaps. Remove
each stated limitation only after its actual implementation and acceptance evidence
exist. The objective remains open until all remaining areas are proved.

## Stdin filename implementation

Native Zip 3.0 captures established stdin-before-argv ordering, blank-line skipping,
trailing-CR removal, preserved spaces/tabs and final unterminated lines. `-@` now
uses the ZIP invocation's tracked source ownership, bounded byte collection and
combined operand/path/work admission. Nine memory tests cover those behaviors,
fragmented UTF-8, repeated flags, rejection without publication, empty input and
draining a held input read before cancellation settles. Native captures are manual
observations, not a complete CLI compliance gate.

## Directory-entry omission

`-D` now prevents selection of new directory entries while preserving recursion
and existing archive directory members. Three memory cases cover recursive
selection through unmatched parents, retained old directories and the nonrecursive
directory-only status 12. Manual native Zip 3.0 observations confirm those effects
and the empty-inclusion behavior when the included directory is omitted.

## Symlink storage

`-y` selects symlink metadata and reads target bytes without resolving the final
link. Initial and post-read snapshots resolve only its parent and check backing
identity, type, size and times before publication. Three memory cases verify live
and broken targets, stored mode/payload, recursion with cycles and escaping targets,
`-j` flattening and replacement detection preserving an old archive. Manual Zip 3.0
captures confirm symlink storage and recursion effects. Default dereferencing and
extraction confinement remain part of regression acceptance.

## Integrity testing

`-T` reads the serialized candidate, then streams and discards decoded payloads
with actual aggregate accounting before publication. Tests cover successful
stored/deflated binary output, quiet suppression, retained CRC and malformed or
trailing DEFLATE, rejected empty results and symlink payloads with file-only
accounting. Manual Zip 3.0 captures establish OK output, quiet suppression and
empty-result status 8 with no published archive. Embedded native UnZip diagnostics
and temporary-name formatting remain a CLI fidelity gap; integrity-test support
does not close the overall compliance goal.

## Archive deletion

`-d` matches operands against archive names and applies inclusion/exclusion without
source filesystem reads. Retained members are copied unchanged, deleted progress
and empty warnings are budgeted before publication, and unmatched names have native
warnings/status 12. Five memory cases verify absent source trees, exact retained
entries/comments, combined filters, all-member deletion, empty integrity rejection,
ignored recursion and missing archives. Manual Zip 3.0 captures establish those
statuses, channels, diagnostics and member effects. Integrity-test progress is
flushed before validation to retain progress on test failure; default creation
still emits completed progress after publication.

## Update and freshen

`-u` and `-f` compare whole-second modification times before reading source bytes;
update adds new members, freshen does not. No-operand invocation selects existing
archive names. Unchanged invocations return status 12 silently without publishing.
Nine memory cases verify fractional-second skipping, newer replacements,
no-operand selection with filters, new-member distinctions, incompatible action
diagnostics, skipped payload reads and absent-archive freshening. Manual Zip 3.0
captures establish the same behaviors, including odd-second Unix timestamps,
freshening progress, missing-archive warnings and update's empty-inclusion result
when creating a missing archive. Format/metadata dialect coverage still requires
the remaining independent compatibility qualification.

## Suffix storage

`-n` accepts colon-separated suffixes and attached/equals values. Native Unix
captures revealed and validated existing default-list defects: suffix matching
is case-sensitive and level 9 overrides storage suffixes. Nine memory cases cover
default/custom matching, case, level-9 precedence, empty defaults, cleared lists
and binary round trips. Matching storage suffixes bypass compression work rather
than compressing and then discarding the result.

## Long options and attached lists

Native long spellings now normalize to implemented short flags without changing
original argv indices or raw-byte admission. Exact names and unique abbreviations
are supported; reserved unimplemented Unix names retain native prefix ambiguity
instead of accidentally enabling a different short option. Native captures also
validated a parser defect: attached `-iVALUE`/`-i=VALUE` and `--include=VALUE`
consume only one value, and empty attached inclusion is valid. Fifteen memory
cases cover grouped semantic effects through long aliases, abbreviation ambiguity,
invalid values, unsupported options, attached includes before archive, empty
inclusion, action aliases, stdin/suffix aliases and literal long-looking paths.
Unimplemented native option aliases remain explicit failures, not completion.

## Explicit compression method

`-Z`/`--compression-method` selects store or DEFLATE with case-insensitive unique
prefixes and attached/separate/equals values. Native captures revealed a precedence
gap: `-0` selects storage, and later effort flags do not re-enable compression;
explicit `-Z deflate` does. Ten memory cases cover method selection, precedence,
round trips, unknown/missing method values, disabled bzip2 status 19 and native
level-zero/DEFLATE status 5 preserving old archive bytes. The current native Unix
Zip build also lacks bzip2, but adding method-12 format support remains in scope
for the broader ZIP objective and other enabled native profiles.
