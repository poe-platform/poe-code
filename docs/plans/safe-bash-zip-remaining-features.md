---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1
readiness: draft

tasks:
  - id: zip-compatibility-inventory
    title: "Establish the complete compatibility inventory"
    prompt: |
      Work in packages/safe-bash on current main; read applicable AGENTS.md and preserve unrelated edits, especially SafeJS. Revalidate the stated gap before changing code and use fast failing tests first. Add no new runtime dependencies and no host-process fallback. Reuse existing codecs, ByteSource/ByteSink, VFS, signal, budgets and owned cleanup contracts. Keep product logic in this package and preserve CLI/SDK parity. Unit fixtures use memory/memfs; upstream/native tools are isolated test oracles only. Do not edit README without authorization. Record revision-specific proof and exclusions in docs/plans/safe-bash-zip-remaining-features-evidence.md. A feature is complete only with positive, negative, boundary, cancellation and neighboring regression controls.

      Inspect src/commands/archive/zip.ts, unzip.ts, zip-format.ts, zip/options.ts, zip/zip64.ts, zip/crypto.ts, docs/ZIP.md and current ZIP tests. Build docs/plans/safe-bash-zip-compatibility-matrix.md covering EVERY native Unix Info-ZIP Zip 3.0 option (including build-dependent features), relevant UnZip behavior, and ZIP records using a pinned PKWARE APPNOTE revision. Record supported, missing, intentionally restricted, not applicable and unverified separately. Reproduce each gap with the smallest case and passing control. Include currently reserved switches: adjust-sfx, temp-path, display family, difference-archive, encrypt, fix/fixfix, fifo, grow, junk-sfx, DOS-names, from-crlf, logging, license, password, regex, split family, show family, unzip-command, verbose/version. Verify current dependency declarations rather than claiming this package is dependency-free.
      Pin upstream test source revisions from libarchive ZIP tests, CPython test_zipfile and Go archive/zip tests; map useful cases to requirements, preserve license/provenance when adapting, and do not add those libraries as product dependencies. Obtain versioned oracle binaries in an isolated test environment with documented setup; unavailable tools are unverified cells, not passes. Keep fixtures compact and unit tests offline. Produce exact native versions, feature builds, platform/timezone profiles and evidence commands.
    status:
      reproduce: open
      implement: open
      test: open
      commit: open
  - id: zip-cli-parity
    title: "Complete informational options and option parsing"
    prompt: |
      Work in packages/safe-bash on current main; read applicable AGENTS.md and preserve unrelated edits, especially SafeJS. Revalidate the stated gap before changing code and use fast failing tests first. Add no new runtime dependencies and no host-process fallback. Reuse existing codecs, ByteSource/ByteSink, VFS, signal, budgets and owned cleanup contracts. Keep product logic in this package and preserve CLI/SDK parity. Unit fixtures use memory/memfs; upstream/native tools are isolated test oracles only. Do not edit README without authorization. Record revision-specific proof and exclusions in docs/plans/safe-bash-zip-remaining-features-evidence.md. A feature is complete only with positive, negative, boundary, cancellation and neighboring regression controls.

      Implement validated missing native Unix CLI behavior in zip/options.ts, zip/help.ts and zip.ts: -v/--version/--verbose distinctions, -L/license, show-files/show-options/show-command/debug, display counters/dots and their grammar. Determine exact native spellings, argument arity, grouped short options, abbreviations, negation, ZIPOPT precedence, immediate exits, stdout/stderr and exit codes from the compatibility matrix. Do not print secrets in command/debug/log output. Preserve byte budgets and early no-I/O help behavior. Cover unknown/ambiguous options, empty/attached values, options after operands, -- paths, binary names and quiet-mode interactions. If capability-dependent content cannot be truthful, document the precise restriction instead of claiming a native build identity. Inspect screenshots using npm run screenshot-poe-code -- for actual visible CLI paths; record manual QA in Markdown.
    status:
      reproduce: open
      implement: open
      refactor: open
      test: open
      commit: open
  - id: zip-reverse-newlines
    title: "Implement native reverse newline conversion"
    prompt: |
      Work in packages/safe-bash on current main; read applicable AGENTS.md and preserve unrelated edits, especially SafeJS. Revalidate the stated gap before changing code and use fast failing tests first. Add no new runtime dependencies and no host-process fallback. Reuse existing codecs, ByteSource/ByteSink, VFS, signal, budgets and owned cleanup contracts. Keep product logic in this package and preserve CLI/SDK parity. Unit fixtures use memory/memfs; upstream/native tools are isolated test oracles only. Do not edit README without authorization. Record revision-specific proof and exclusions in docs/plans/safe-bash-zip-remaining-features-evidence.md. A feature is complete only with positive, negative, boundary, cancellation and neighboring regression controls.

      Add -ll/--from-crlf in zip/line-endings.ts, zip/options.ts and zip.ts. Match verified Info-ZIP conversion semantics for CRLF, bare CR/LF, trailing Ctrl-Z, binary detection, warnings and -l interactions; do not assume global text replacement reproduces native behavior. Preserve original CRC/size versus transformed CRC/size according to the archive format, binary byte ownership and suffix/compression selection. Parameterize chunk boundaries including CR at end of chunk and LF at start of next, empty input, repeated CR, mixed line endings, final partial chunks and boundaries around native read/compressor windows. Compare STORE and DEFLATE modes and prove extraction emits the expected converted bytes.
    status:
      reproduce: open
      implement: open
      refactor: open
      test: open
      commit: open
  - id: zip-streaming
    title: "Stream source bytes through compression to output"
    prompt: |
      Work in packages/safe-bash on current main; read applicable AGENTS.md and preserve unrelated edits, especially SafeJS. Revalidate the stated gap before changing code and use fast failing tests first. Add no new runtime dependencies and no host-process fallback. Reuse existing codecs, ByteSource/ByteSink, VFS, signal, budgets and owned cleanup contracts. Keep product logic in this package and preserve CLI/SDK parity. Unit fixtures use memory/memfs; upstream/native tools are isolated test oracles only. Do not edit README without authorization. Record revision-specific proof and exclusions in docs/plans/safe-bash-zip-remaining-features-evidence.md. A feature is complete only with positive, negative, boundary, cancellation and neighboring regression controls.

      Refactor zip-format.ts and zip.ts so streamable create/stdin/stdout paths consume ByteSource incrementally and emit before source EOF, retaining bounded central metadata rather than all payloads. Keep readZipArchive/writeZipArchive buffered convenience APIs compatible; do not merely chunk an already buffered archive. Use descriptors where sizes/CRC are unknown. Stage VFS file output using existing publication/identity contracts; update/copy must remain correct even when their source profile requires buffered or seekable access, with explicit documented limits. Enforce all input, output, archive, metadata and work budgets before retention/allocation; await sinks and close cooperative sources on cancellation/failure. Prove output before EOF with a gated source, slow-sink backpressure, producer buffer reuse, no eager source draining, early sink rejection, abort at each phase, cleanup and no accidental publication. Record bounded retention counters rather than claiming process RSS isolation.
    status:
      reproduce: open
      implement: open
      refactor: open
      test: open
      commit: open
  - id: zip-large-zip64
    title: "Complete automatic large-size and offset ZIP64"
    prompt: |
      Work in packages/safe-bash on current main; read applicable AGENTS.md and preserve unrelated edits, especially SafeJS. Revalidate the stated gap before changing code and use fast failing tests first. Add no new runtime dependencies and no host-process fallback. Reuse existing codecs, ByteSource/ByteSink, VFS, signal, budgets and owned cleanup contracts. Keep product logic in this package and preserve CLI/SDK parity. Unit fixtures use memory/memfs; upstream/native tools are isolated test oracles only. Do not edit README without authorization. Record revision-specific proof and exclusions in docs/plans/safe-bash-zip-remaining-features-evidence.md. A feature is complete only with positive, negative, boundary, cancellation and neighboring regression controls.

      Extend zip/zip64.ts, zip-format.ts and archive admission only after incremental streaming is present. Promote sizes, compressed sizes, offsets and directory sizes independently when classic sentinel boundaries require ZIP64. Cover exact 0xffffffff and neighboring values, 65535 counts, unknown-length stdin, forced/disabled ZIP64, 32/64-bit signed and unsigned descriptors, mixed classic/ZIP64 members, central offset and locator correctness. Preserve configured limits and reject values beyond safe representability before arithmetic/allocation. Avoid multi-gigabyte unit buffers: test factored record encoders with virtual counters and memory stream fixtures, then document a separate bounded manual large-artifact interoperability check with expected central-directory fields. Raising a constant cap without making input/output streaming is insufficient.
    status:
      reproduce: open
      implement: open
      refactor: open
      test: open
      commit: open
  - id: zip-traditional-encryption
    title: "Integrate traditional password-protected ZIPs"
    prompt: |
      Work in packages/safe-bash on current main; read applicable AGENTS.md and preserve unrelated edits, especially SafeJS. Revalidate the stated gap before changing code and use fast failing tests first. Add no new runtime dependencies and no host-process fallback. Reuse existing codecs, ByteSource/ByteSink, VFS, signal, budgets and owned cleanup contracts. Keep product logic in this package and preserve CLI/SDK parity. Unit fixtures use memory/memfs; upstream/native tools are isolated test oracles only. Do not edit README without authorization. Record revision-specific proof and exclusions in docs/plans/safe-bash-zip-remaining-features-evidence.md. A feature is complete only with positive, negative, boundary, cancellation and neighboring regression controls.

      Integrate the existing zip/crypto.ts ZipCrypto transform into writer, reader, zip and unzip password workflows. Implement -P and -e native command semantics using legitimate injected entropy and interactive input capabilities; never read ambient host state or use deterministic product encryption headers. If no no-echo prompt capability exists, add the minimum explicit host contract and carry it through SDK/CLI without changing SafeJS, or document the capability failure precisely. Encode/validate 12-byte encryption headers, correct CRC/time verifier under descriptor flags, compression/encryption ordering and per-member keys. Cover empty/Unicode/raw-byte passwords according to the pinned profile, wrong passwords, truncated headers, deliberately colliding verifier bytes, mixed encrypted/plain members, comments, copy/update, -T and -p. Always verify final CRC/length before publication; the header byte is not authentication. Never leak passwords through progress/debug/log diagnostics. Use deterministic test entropy only in fixtures and native cross-read both directions.
    status:
      reproduce: open
      implement: open
      refactor: open
      test: open
      commit: open
  - id: zip-archive-operations
    title: "Complete remaining archive operation switches"
    prompt: |
      Work in packages/safe-bash on current main; read applicable AGENTS.md and preserve unrelated edits, especially SafeJS. Revalidate the stated gap before changing code and use fast failing tests first. Add no new runtime dependencies and no host-process fallback. Reuse existing codecs, ByteSource/ByteSink, VFS, signal, budgets and owned cleanup contracts. Keep product logic in this package and preserve CLI/SDK parity. Unit fixtures use memory/memfs; upstream/native tools are isolated test oracles only. Do not edit README without authorization. Record revision-specific proof and exclusions in docs/plans/safe-bash-zip-remaining-features-evidence.md. A feature is complete only with positive, negative, boundary, cancellation and neighboring regression controls.

      From the complete matrix implement validated -DF/difference-archive, -g/grow, -b/temp-path and -J/junk-sfx semantics in zip.ts and focused zip modules. Cover create/update/freshen/copy/delete/filesync combinations, empty selections, comments, duplicate names, aliases, separate output, cancellation and publication failures. Grow must have native-visible semantics without bypassing validated staged replacement or leaving damaged existing archives. Temp paths stay inside authorized VFS and require truthful provider capabilities. Junk-SFX removes a validated prefix; it must not blindly strip arbitrary bytes. Implement log file path/append/info with VFS byte I/O, sink limits, ownership, failure/status and secret redaction. Implement -T/-TT test-command behavior only through registered virtual commands and explicit supported command parsing; never spawn the host unzip command. Preserve already delivered -m conditional source removal.
    status:
      reproduce: open
      implement: open
      refactor: open
      test: open
      commit: open
  - id: zip-fifo-and-names
    title: "Complete source and filename compatibility switches"
    prompt: |
      Work in packages/safe-bash on current main; read applicable AGENTS.md and preserve unrelated edits, especially SafeJS. Revalidate the stated gap before changing code and use fast failing tests first. Add no new runtime dependencies and no host-process fallback. Reuse existing codecs, ByteSource/ByteSink, VFS, signal, budgets and owned cleanup contracts. Keep product logic in this package and preserve CLI/SDK parity. Unit fixtures use memory/memfs; upstream/native tools are isolated test oracles only. Do not edit README without authorization. Record revision-specific proof and exclusions in docs/plans/safe-bash-zip-remaining-features-evidence.md. A feature is complete only with positive, negative, boundary, cancellation and neighboring regression controls.

      Implement matrix-validated FIFO source selection (-FI), DOS name conversion (-k), and the native build-dependent regex selection option where applicable. FIFO reads require an explicit stream-capable VFS source, cancellation and limits; unsupported providers return truthful capability errors and never read host FIFOs implicitly. Define transformation ordering relative to -j, -r/-R, include/exclude, case, Unicode/raw names and archive fallback. Cover DOS-name collisions, multiple extensions, reserved names, separators, wildcards, hidden files, empty streams and producer failure. Do not add a regex runtime dependency or route unsafe unbounded matching into product selection. If the pinned Unix build does not expose an option, record not-applicable for that build and separately qualify other profiles.
    status:
      reproduce: open
      implement: open
      refactor: open
      test: open
      commit: open
  - id: zip-split-volumes
    title: "Implement split and multivolume archives"
    prompt: |
      Work in packages/safe-bash on current main; read applicable AGENTS.md and preserve unrelated edits, especially SafeJS. Revalidate the stated gap before changing code and use fast failing tests first. Add no new runtime dependencies and no host-process fallback. Reuse existing codecs, ByteSource/ByteSink, VFS, signal, budgets and owned cleanup contracts. Keep product logic in this package and preserve CLI/SDK parity. Unit fixtures use memory/memfs; upstream/native tools are isolated test oracles only. Do not edit README without authorization. Record revision-specific proof and exclusions in docs/plans/safe-bash-zip-remaining-features-evidence.md. A feature is complete only with positive, negative, boundary, cancellation and neighboring regression controls.

      Add focused zip/volumes.ts and extend zip/zip64.ts, zip-format.ts, zip.ts and unzip.ts for -s split size and related pause/verbose/bell behavior supported by the target build. Define an explicit VFS volume resolver and prompt capability instead of ambient disk discovery. Parse disk numbers, relative offsets and ZIP64 multi-disk locators; write .z01/.z02/final .zip names with correct split signatures. Cover boundaries inside payloads and allowed record boundaries, minimum split sizes, exact rollover, missing/out-of-order/repeated volumes, aliases, descriptor boundaries, encrypted members and copy/recombine. Preflight all destinations and stage every volume; document whether publication is per-volume because a VFS without transactions cannot guarantee all-volume rollback. Prove failures/cancellation leave existing volumes intact where the contract promises it and clean only owned stages.
    status:
      reproduce: open
      implement: open
      refactor: open
      test: open
      commit: open
  - id: zip-repair-and-sfx
    title: "Support self-extracting prefixes and explicit repair"
    prompt: |
      Work in packages/safe-bash on current main; read applicable AGENTS.md and preserve unrelated edits, especially SafeJS. Revalidate the stated gap before changing code and use fast failing tests first. Add no new runtime dependencies and no host-process fallback. Reuse existing codecs, ByteSource/ByteSink, VFS, signal, budgets and owned cleanup contracts. Keep product logic in this package and preserve CLI/SDK parity. Unit fixtures use memory/memfs; upstream/native tools are isolated test oracles only. Do not edit README without authorization. Record revision-specific proof and exclusions in docs/plans/safe-bash-zip-remaining-features-evidence.md. A feature is complete only with positive, negative, boundary, cancellation and neighboring regression controls.

      Add focused zip/repair.ts plus reader/command changes for SFX prefix handling, -A offset adjustment and -F/-FF recovery. Reading an SFX archive must never execute its prefix. Keep ordinary parsing strict; recovery runs only when explicitly requested and has bounded scan/work budgets. Validate candidate signatures, spans, local/central records, descriptors, CRCs and names; embedded signatures inside payloads are not automatically members. Cover prefixes with/without adjusted offsets, missing/truncated EOCD/central directory, orphan local records, gaps, trailing bytes, overlapping entries, duplicate candidates and corrupt payloads. Never overwrite the only damaged source during recovery; use verified separate-output semantics and label partial recovery explicitly with native-compatible diagnostics/status. Extraction retains traversal/symlink protections even for recovered metadata.
    status:
      reproduce: open
      implement: open
      refactor: open
      test: open
      commit: open
  - id: zip-metadata-platform-parity
    title: "Qualify names, metadata and filesystem edge cases"
    prompt: |
      Work in packages/safe-bash on current main; read applicable AGENTS.md and preserve unrelated edits, especially SafeJS. Revalidate the stated gap before changing code and use fast failing tests first. Add no new runtime dependencies and no host-process fallback. Reuse existing codecs, ByteSource/ByteSink, VFS, signal, budgets and owned cleanup contracts. Keep product logic in this package and preserve CLI/SDK parity. Unit fixtures use memory/memfs; upstream/native tools are isolated test oracles only. Do not edit README without authorization. Record revision-specific proof and exclusions in docs/plans/safe-bash-zip-remaining-features-evidence.md. A feature is complete only with positive, negative, boundary, cancellation and neighboring regression controls.

      Audit and repair validated metadata/name/platform gaps in zip-format.ts, zip/safety.ts, zip/dates.ts, zip/comments.ts and unzip.ts. Adapt pinned public test cases for UTF-8 flag versus Unicode path/comment extras, CP437, invalid encodings, embedded NUL, duplicate names, local/central mismatches, DOS timestamps, odd seconds, timezone/DST, Unix permissions/types and unknown extras. Test untouched-member preservation versus rewritten extras, timestamps/comments at field length boundaries, -X/-X-, directories, symlinks, aliases and unknown identity. Keep absolute paths, parent traversal and symlink escapes refused; do not weaken these deliberately constrained VFS behaviors for apparent parity. Document intentional differences and capability requirements with exact observable consequences. Add host-platform oracle cells only where available, reporting unavailable platforms separately.
    status:
      reproduce: open
      implement: open
      refactor: open
      test: open
      commit: open
  - id: zip-aes-extension
    title: "Add authenticated AES ZIP interoperability"
    prompt: |
      Work in packages/safe-bash on current main; read applicable AGENTS.md and preserve unrelated edits, especially SafeJS. Revalidate the stated gap before changing code and use fast failing tests first. Add no new runtime dependencies and no host-process fallback. Reuse existing codecs, ByteSource/ByteSink, VFS, signal, budgets and owned cleanup contracts. Keep product logic in this package and preserve CLI/SDK parity. Unit fixtures use memory/memfs; upstream/native tools are isolated test oracles only. Do not edit README without authorization. Record revision-specific proof and exclusions in docs/plans/safe-bash-zip-remaining-features-evidence.md. A feature is complete only with positive, negative, boundary, cancellation and neighboring regression controls.

      Implement a separate WinZip AES extension profile beyond Info-ZIP Zip 3.0 using a pinned AES specification and APPNOTE extra-field definitions. Reuse existing vetted crypto primitives and explicit entropy; add no runtime dependency and do not invent a cipher. Expose an explicit compression/encryption configuration through the actual archive plugin SDK and CLI; do not silently reinterpret native -e as AES. Support required AES strengths and AE-1/AE-2 CRC/authentication semantics with correct 0x9901 extras, salt, verifier, encrypted payload and authentication tag. Require a bounded authenticated staging policy so unauthenticated plaintext is not published or sent through unzip -p; document that this changes latency/retention compared with plain streaming. Test independent known vectors, cross-read with an AES-capable oracle, wrong password, tampered salt/header/payload/tag, truncation, unsupported strengths/version, mixed members and cancellation. If existing approved primitives cannot safely implement the profile, record a concrete blocker rather than adding a dependency or shipping unauthenticated behavior.
    status:
      reproduce: open
      implement: open
      refactor: open
      test: open
      commit: open
  - id: zip-additional-codecs
    title: "Add LZMA and PPMd format extensions"
    prompt: |
      Work in packages/safe-bash on current main; read applicable AGENTS.md and preserve unrelated edits, especially SafeJS. Revalidate the stated gap before changing code and use fast failing tests first. Add no new runtime dependencies and no host-process fallback. Reuse existing codecs, ByteSource/ByteSink, VFS, signal, budgets and owned cleanup contracts. Keep product logic in this package and preserve CLI/SDK parity. Unit fixtures use memory/memfs; upstream/native tools are isolated test oracles only. Do not edit README without authorization. Record revision-specific proof and exclusions in docs/plans/safe-bash-zip-remaining-features-evidence.md. A feature is complete only with positive, negative, boundary, cancellation and neighboring regression controls.

      After inspecting the complete matrix and existing compression assets, add bounded ZIP LZMA (method 14) and PPMd (method 98) interoperability as separate format extensions, not claims about native Info-ZIP Zip 3.0. Reuse existing suitable codecs only after validating ZIP framing, properties/version, end markers and cooperative limits. If none exists, design a minimal dependency-free codec with independent published vectors and pinned public fixtures before implementation; do not vendor an unaudited external library or claim support from recognizing a method number. Cover encode/decode, empty/small/incompressible inputs, malformed properties, excessive dictionary/model requests, truncated streams, output bombs, cancellation and method-specific flags/extraction versions. Preserve STORE/DEFLATE/BZIP2 tests and keep unavailable codec cells explicitly open. Each codec is a separate atomic improvement.
    status:
      reproduce: open
      implement: open
      refactor: open
      test: open
      commit: open
  - id: zip-final-qualification
    title: "Verify the complete compatibility profile and document remaining restrictions"
    prompt: |
      Work in packages/safe-bash on current main; read applicable AGENTS.md and preserve unrelated edits, especially SafeJS. Revalidate the stated gap before changing code and use fast failing tests first. Add no new runtime dependencies and no host-process fallback. Reuse existing codecs, ByteSource/ByteSink, VFS, signal, budgets and owned cleanup contracts. Keep product logic in this package and preserve CLI/SDK parity. Unit fixtures use memory/memfs; upstream/native tools are isolated test oracles only. Do not edit README without authorization. Record revision-specific proof and exclusions in docs/plans/safe-bash-zip-remaining-features-evidence.md. A feature is complete only with positive, negative, boundary, cancellation and neighboring regression controls.

      Re-run the full matrix on the exact final revision, including prior -j regression and all delivered recursion/update/copy/move/comments/help/BZIP2 behaviors. Add deterministic generated cross-products of options, archive structure mutations and chunk partitions with fixed seeds and minimized counterexamples; avoid slow combinatorial unit suites. Independently adapt useful pinned libarchive, CPython and Go boundary/malformed fixtures rather than mirroring implementation helpers. Run npm run build, npm test and maintained repository lint because streaming/format/contracts changes are broad; also run focused package tests and inspect visible CLI screenshots. Write Markdown manual QA with invocation/expected bytes/status/effects for password cross-read, newline conversion, gated stdin/stdout, ZIP64 central fields, split reassembly, SFX and damaged recovery. Update docs/ZIP.md with verified profiles, limits, interaction rules, configuration and capability requirements; do not edit README without authorization. Never claim universally fully compliant: only mark a pinned profile complete when every applicable matrix row passes and every deliberate restriction is clearly disclosed. Report fails/skips/unsupported/unverified separately.
    status:
      reproduce: open
      implement: open
      test: open
      commit: open
  - id: zip-delivery
    title: "Deliver verified changes and monitor GitHub publication"
    prompt: |
      Work in packages/safe-bash on current main; read applicable AGENTS.md and preserve unrelated edits, especially SafeJS. Revalidate the stated gap before changing code and use fast failing tests first. Add no new runtime dependencies and no host-process fallback. Reuse existing codecs, ByteSource/ByteSink, VFS, signal, budgets and owned cleanup contracts. Keep product logic in this package and preserve CLI/SDK parity. Unit fixtures use memory/memfs; upstream/native tools are isolated test oracles only. Do not edit README without authorization. Record revision-specific proof and exclusions in docs/plans/safe-bash-zip-remaining-features-evidence.md. A feature is complete only with positive, negative, boundary, cancellation and neighboring regression controls.

      When execution and delivery of this pipeline are authorized, deliver its atomic verified commits on main using normal hooks, no force push and no unrelated staging. This planning request itself does not authorize running the pipeline or pushing. Revalidate after concurrent-main integration; preserve SafeJS and other workers. Verify delivered ancestry and monitor all required GitHub publication workflows, following successors only after confirming they contain the delivered changes. Inspect docs/development/NPM_PUBLISHING.md and the actual scoped-package publication contract; if a new optional package lacks GitHub trusted-publisher bootstrap, report the exact external blocker and approved recovery route, never substitute local/token publishing. Confirm registry versions and provenance, then smoke test installed artifacts with a compact ZIP create/extract/password example. Record local SHA, remote-main evidence, workflow URL/conclusion and each actual published version separately. A push or green build alone is not verified publication.
    status:
      release: open
---

# Remaining ZIP features

This pipeline plans the remaining features; it does not execute them. Tasks are ordered so the inventory defines the target first, streaming enables large ZIP64, and format extensions follow native CLI compatibility.

## Completion target

Use pinned Unix Info-ZIP Zip 3.0 builds plus a pinned PKWARE APPNOTE revision. Qualify WinZip AES, ZIP LZMA and ZIP PPMd separately. Safety restrictions and backend capability limits remain explicit; a complete option list alone does not establish full format compliance.

## Execution and evidence

Run in order. Each task prompt is self-contained. The configured reproduce, implement, refactor, test, commit and release steps are selected only where applicable; inherited teardown remains active. No implementation, commit or publication is performed by creating this plan.

Maintain the compatibility matrix and revision-specific evidence under docs/plans. Test inspiration must include source revision, applicable requirement and licensing when adapted. Unit tests remain in memory and offline; native comparisons and large artifacts belong to isolated manual/integration QA.

No new runtime dependencies are planned. Current package dependencies are inventory facts, not changes authorized by this plan. SafeJS/Acorn work stays outside this pipeline.

## Acceptance checklist

- [ ] Every applicable pinned native option and ZIP record family has an independently verified matrix result.
- [ ] -ll matches byte-level conversion and boundary behavior.
- [ ] Streamable source-to-output paths demonstrate backpressure and output before EOF.
- [ ] Large size/offset ZIP64 transitions work without giant unit allocations.
- [ ] Traditional encryption cross-reads; wrong passwords and corrupt data never publish invalid files.
- [ ] Remaining operation, display, logging, selection and capability-dependent switches are qualified.
- [ ] Split archives, SFX offsets and explicit recovery have interoperability and failure evidence.
- [ ] Metadata, path safety, aliases, cancellation and budget boundaries retain their contracts.
- [ ] AES, LZMA and PPMd have separate independent format-extension evidence or remain explicitly incomplete.
- [ ] Final maintained build/lint/test gates and visible CLI QA pass on the candidate revision.
- [ ] Local commits, remote-main delivery and successful publication are reported separately.
