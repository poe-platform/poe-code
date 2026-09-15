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
