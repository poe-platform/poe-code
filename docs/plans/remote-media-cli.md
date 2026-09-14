---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1
name: JavaScript FFmpeg and ImageMagick CLI with remote sandbox execution
readiness: draft
setup:
  prompt: |
    Read applicable AGENTS.md and execute docs/plans/remote-media-cli.md in listed
    order. Build FFmpeg/ffprobe and ImageMagick shims in JavaScript/TypeScript.
    The shims parse for dependency discovery and transport, upload files, call the
    sandbox API and return streams, file effects and exit status. Stock native
    executables remain authoritative for media operations, validation and diagnostics. Native media
    processing runs on a server in Cloudflare Sandbox, with a generic protocol and
    Modal adapter. The user rejected a single-file restricted CLI and a filesystem-
    bridge-only replacement for the JavaScript frontend. Runtime file requests may
    supplement the frontend for dynamically discovered dependencies. Do not silently
    reduce full compatibility to a curated option subset. Forward original argv;
    discovery must not introduce earlier native errors or duplicate native execution.
    safe-bash is noninteractive. Preserve the complete noninteractive command surface;
    do not add PTYs, terminal UI, terminal resize or foreground terminal job control.
    Missing required shell/descriptor/filesystem support is implementation work, not
    an exclusion from compatibility. Preserve stdin-driven behavior and native EOF
    handling; never inject -nostdin, -y or -n unless the user supplied those options.
    Keep existing Python/document plans independent. All planning/manual QA plans
    belong in docs/plans; evidence belongs in docs/remote-media. Use TDD for code,
    fast in-memory unit tests, native oracles only in opt-in integration, and scoped
    delegation for safe-bash work. The user's explicit remote-native execution
    request permits server-side processes, not local host execution by virtual
    commands. Preserve unrelated changes and work on main. Do not commit, push,
    provision paid resources or deploy merely by executing this planning draft.
    README changes require permission; prepare usage text in docs/remote-media.

    Use stepless tasks with scalar status: open, as explicitly requested, even though
    repository step definitions exist. Establish exactly two new workspaces: media-cli
    and remote-execution. Shared protocol/client and Node-only server live in separate
    remote-execution subpath exports. media-cli depends on remote-execution, never the
    reverse; its server bootstrap injects tool definitions into the generic server.
    The safe-bash adapter uses an injected structural engine, avoiding package cycles.
    This is a plan for later execution; the current request authorizes documentation only.
teardown:
  prompt: |
    Reconcile docs/remote-media compatibility, source, dependency and example
    registers. Keep every unqualified required behavior open. Report actual tests,
    provider experiments, native build identity, filesystem/process differences
    and missing capabilities. Update this plan only from evidence. No automatic
    Git staging, commits, pushes or deployments. If delivery is separately requested,
    report local commits, verified remote main and successful release separately,
    and monitor any authorized push through publication. Preserve unrelated files.
tasks:
  - id: inventory-native-cli-semantics
    title: Pin native builds and inventory the complete command surface
    prompt: |
      Read applicable AGENTS.md. Research JavaScript shims for
      ffmpeg, ffprobe and ImageMagick command frontends with remote native execution.
      Start from FFmpeg commit 639ee849526cfe61ceb312776335c245b98bd9d4 at
      https://github.com/FFmpeg/FFmpeg and ImageMagick commit
      2ed1b96b9bc71434f0c4e82e3c63fec029c684c6 at
      https://github.com/ImageMagick/ImageMagick. These are inspected source snapshots;
      deliberately select and pin production release/build digests before porting.
      Inspect fftools/cmdutils.c, ffmpeg_opt.c, ffprobe.c, option tables and libavutil,
      libavformat and libavfilter resolution paths. Inspect MagickWand/magick-cli.c,
      operation.c, script-token.c, legacy command parsers and MagickCore option,
      filename, blob, property and delegate resolution. Trace source rather than
      assuming help output fully defines the grammar. Retain required source/license
      attribution separately and determine obligations before porting implementation.
      Create docs/remote-media source, option, dependency and compatibility registers.
      Include option arity/scope/aliases, error timing, encoders/filters/demuxers,
      protocols, coders/delegates, fonts, environment, native CLI aliases, scripts,
      device/GPU requirements within noninteractive execution and every observable output class. Map each family
      to an owner/task and independent cases. Include magick identify/mogrify/compare/
      montage/composite and inventoried installed aliases; do not invent ffplay scope.
      Establish same-build native oracles and identify nondeterministic fields.
      Completion means complete accounting and reproducible baselines, not parity.
    status: open
  - id: define-remote-media-contracts
    title: Define package ownership, execution protocol and compatibility contract
    prompt: |
      Design the JS media frontend and generic sandbox server against current
      packages/safe-bash/src/contracts/{command,plugin,output,filesystem-descriptor}.ts
      and packages/safe-fs/src/contracts/. Read applicable AGENTS.md. Use exactly two
      new packages: packages/media-cli for FFmpeg/ImageMagick grammar, dependency
      resolution and native tool definitions; packages/remote-execution for shared
      protocol, portable client, file transfer/materialization, jobs/streams/recovery,
      Node-only server and isolated provider adapters. media-cli/server composes the
      server with tool definitions and deployment assets. No third media-server package.
      Dependency direction is media-cli -> remote-execution; safe-bash receives an
      injected structural engine and imports neither package at runtime. Root SDK
      constructs the optional engine and keeps normal shell startup lightweight.
      Read process-runner/types.ts, host/host-runner.ts and workspace-transfer.ts,
      agent-harness-tools/execution-env.ts and toolcraft-openapi/http.ts before reuse.
      Existing agent runtime discriminants, Buffer transfers and buffered/base64 OpenAPI
      responses are not the media protocol. Consider native Runner only inside the Node
      server and qualify signal/spawn-error semantics before adoption. Do not change
      shared runner behavior without reproduced failures and focused TDD.
      Write docs/remote-media/contracts.md and versioned HTTP/binary schemas. Define
      argv bytes, cwd/env, build identity, sessions/jobs, blob uploads, directory manifests,
      logical namespace mapping, materialization revisions, retained file identities,
      ordered effects, descriptors and callback authorization. Upload and materialize
      are explicit public API operations, available without the media CLI.
      Define MediaCommandEngine.execute(request) structurally: request carries command,
      readonly Uint8Array[] args, cwd, env, ByteSource stdin, optional seekable stdinInput,
      ByteSink stdout/stderr, canonical FileSystem access through shell-accounted file
      operations, AbortSignal and registerCleanup. Return Promise<{ exitCode: number }>.
      Extra descriptors use an additive admitted-handle capability. Do not buffer stream
      results in the return value. Define handle ownership and who awaits cleanup.
      Expose the full execution lifecycle through SDK/API, not one endpoint per transform.
      Provider definitions are declarative over generic drivers, with no core name switches.
      Distinguish transport/native errors, partial outputs, cancellation and unknown outcome.
      No exactly-once claim across lost state. Define read freshness and live output
      visibility before choosing caching. New-package README/config/env coverage needs
      permission; prepare drafts in docs/remote-media meanwhile. Use parser-based config
      edits and meaningful contract tests for code changes, no implementation in this
      planning turn.
    status: open
  - id: establish-two-package-boundaries
    title: Establish portable and server-only exports in two packages
    prompt: |
      For future implementation, create packages/media-cli and packages/remote-execution
      using maintained workspace declarations/build routes after reading applicable
      AGENTS.md. Do not add a third protocol/provider/server package. remote-execution
      owns portable protocol/validation/client code and separate Node server/provider
      subpaths; server exports may use native processes, browser imports may not.
      media-cli owns ffmpeg, ffprobe and ImageMagick parsers/resolvers and tool-specific
      server profile/bootstrap assets. Its dependency is remote-execution, never reverse.
      Both may use canonical safe-fs contracts; remote-execution must not depend on
      safe-bash, media-cli, root CLI or agent-harness orchestration. safe-bash's thin
      commands/media adapter accepts a structural injected engine like commands/pptx
      but preserves streams rather than copying its buffered artifact interface.
      Use explicit Node/browser/workerd export boundaries and side-effect-free imports.
      Build the server image from media-cli's bootstrap importing remote-execution/server;
      server configuration admits injected tool definitions without a tool-name switch.
      Qualify SDK/public-consumer imports and ensure native/provider SDK code cannot enter
      browser or default safe-bash bundles. Use maintained package/build membership,
      not custom fixed build lists. Prepare package README/config/env drafts in
      docs/remote-media pending permission. This task's implementation happens only after
      planning; use TDD for new runtime code and focused maintained tests.
    status: open
  - id: prove-end-to-end-execution-boundary
    title: Prove the remote server and late dependency mechanism before broad porting
    prompt: |
      Prove the JS frontend plus remote native server architecture with failing
      contract tests and one original integration fixture per tool. Read applicable
      AGENTS.md and docs/remote-media/contracts.md. A local disposable container may
      be used as an explicitly invoked integration server, never a product fallback.
      Pass argv without shell evaluation, upload canonical Uint8Array input, execute
      native media work and recover output/exit status through the proposed protocol.
      Include an FFmpeg concat list whose relative second input is not known until
      read, a filter loading another file, and ImageMagick reading text through @file.
      Prove runtime requests for stat/list/open/read/seek and output operations before
      the native process observes absence or stale data. Requests must be served by
      the JS dependency/filesystem owner without rerunning the whole command.
      Evaluate narrow native I/O hooks or an optional mount only as a server transport
      mechanism; neither replaces the required JavaScript parser/resolver. Enumerate
      coverage of delegates, libc/direct syscalls, mmap, directory traversal and
      non-file protocols. LD_PRELOAD alone is not proof of complete interception.
      The native execution interface is the stock ffmpeg, ffprobe and ImageMagick
      executable family with original argv, cwd, env and admitted descriptors. Do not
      build a custom native media-operation ABI or replace native CLI execution with
      JS-controlled pixel operations. Runtime filesystem mediation may support these
      stock processes and their descendants; it is not a second CLI implementation.
      FFmpeg ffmpeg_parse_options performs I/O; never invoke it as a discovery dry-run.
      Metadata-dependent dependency names are resolved by actual runtime accesses,
      not by independently probing a non-repeatable input or decoding media in JS.
      Before starting this proof, establish an available isolated Linux runtime:
      an explicitly authorized local container installation or minimal cloud run.
      The current environment has neither a local container runtime nor magick.
      Record the exact blocker until that prerequisite is satisfied; mocks cannot pass.
      Compare effect/error ordering, blocked-request cancellation and a cold missing
      dependency. If no complete late-I/O path works in an intended provider, record
      that exact blocker and keep full-compatibility work open. Do not substitute
      FUSE-only execution, whole-workspace upload, silent dependency exclusions or
      retry-after-ENOENT as the final design. Keep experiments separate from unit tests.
    status: open
  - id: extend-invocation-descriptor-contracts
    title: Expose inherited descriptors and noninteractive process control
    prompt: |
      Read applicable AGENTS.md and docs/remote-media/safe-bash-contract-findings.md.
      After the initial end-to-end proof, add invocation contracts to existing
      safe-bash owners for admitted numbered descriptors, alias/shared cursor ownership,
      and ordered process signals. Current CommandContext exposes
      only stdin/stdout/stderr and AbortSignal; shell-internal descriptors and trap hooks
      are not a registered-command API. Keep existing callers compatible. Integrate
      remote-execution handle mapping without importing it into safe-bash. Test progress
      on fd 3, two inherited inputs, dup/close, idle versus EOF, append, broken pipes,
      cancellation versus SIGINT and signal-only exits. safe-bash is noninteractive:
      use byte streams, not a PTY. Use failing in-memory contract tests first; qualify
      descendant process cleanup separately. Preserve shell output accounting.
    status: open
  - id: extend-canonical-object-and-path-contracts
    title: Preserve portable object identity, byte paths and exact offsets
    prompt: |
      Read applicable AGENTS.md and docs/remote-media/safe-bash-contract-findings.md.
      Extend existing safe-fs contracts only where native fixtures establish a need:
      authority-issued retained object handles, byte paths, exact large offsets,
      special-file capabilities and metadata operations. Current object/symbol identity
      scopes are not wire identifiers, string paths cannot represent all Unix names,
      and number offsets cannot represent every native offset exactly. Preserve current
      string/number callers through additive capabilities. Define remote-execution wire
      representations and server launcher handling without lossy UTF-8 or numeric
      conversion. Test hardlink aliases, rename/unlink of open objects, invalid UTF-8,
      cross-mount errors, sparse offsets beyond safe integers and unsupported backends.
      Do not fake devices/FIFOs with regular files or infer identity from a pathname.
      No new workspace is needed. Use TDD and in-memory unit tests; native cases remain
      explicitly invoked integration evidence.
    status: open
  - id: qualify-live-filesystem-and-mapping-bridge
    title: Qualify dynamic native access, mmap, locking and canonical coherence
    prompt: |
      Read applicable AGENTS.md, docs/remote-media/safe-bash-contract-findings.md and
      docs/remote-media/native-research-findings.md. Implement and qualify the runtime
      file mediation selected by the early execution-boundary proof in remote-execution
      server/transfer owners. Keep JavaScript parsing and dependency resolution in
      media-cli. A libavformat io_open callback does not cover direct filter fopen,
      mapped files or ImageMagick delegate subprocesses. Cover actual native accesses
      including retained objects, absolute paths, symlinks and descendant processes.
      Design authority-side operation ordering, read freshness, cache invalidation,
      mapping/truncate/flush barriers and object/range locks with ownership cleanup.
      Uploaded blobs are validated cache entries, not permanently authoritative copies.
      Compare direct I/O and cached write-through on the deployed kernel; qualify mmap
      behavior explicitly. Do not assume FUSE support establishes coherence, or enable
      writeback caching when writers outside that cache can mutate canonical files.
      Separate operation admission, authoritative commit and native notification
      completion. Never hold authority locks across notifications that can reenter file
      operations. Use a dedicated notification queue with object/revision correlation;
      do not acknowledge visibility while a required invalidation remains unresolved.
      Distinguish flush, fsync, release and lookup-reference retirement: native release
      errors do not become close errors, duplicated descriptors can trigger repeated
      flushes, and mappings can outlive descriptors. Do not defer all publication to
      release. Test reentrant invalidation, older pending writes, unsupported notification
      versions, duplicated-fd close, close while mapped and independent-client locks.
      Test changing drawtext content, shared mappings, locks across clients, early
      truncation, progressive outputs, unlink while open and network loss mid-write.
      Record provider/kernel/backend combinations and unresolved capabilities. Source
      reasoning and mocks do not count as deployed qualification. Use TDD for code.
    status: open
  - id: qualify-native-error-stage-compatibility
    title: Bind error timing and filesystem effects to the selected native release
    prompt: |
      Read docs/remote-media/ffmpeg-native-ordering-probes.json and
      docs/remote-media/native-research-findings.md. Reproduce independent fixtures
      against the exact selected production build before encoding JS expectations.
      The inspected local FFmpeg 8.1 oracle preserves an existing output for an unknown
      later option or missing LUT, but truncates its first output before failing on a
      second output's missing parent. Its -n overwrite refusal reports exit 0, unlike
      assumptions based on another source revision. Optional unmatched -map 0:a? can
      leave automatic stream selection active. Preserve native stage ordering, raw
      diagnostics, exit projection and partial effects; no eager validation that changes
      externally observable behavior. Add native ImageMagick equivalents for early
      -write, mogrify, delegates and later syntax/resource errors. Record release source,
      executable/config digests, platform, argv, effects and status. Use independent fast
      JS unit expectations plus opt-in native differential tests; never derive both sides
      from one parser. Local macOS evidence is not Linux/cloud parity certification.
    status: open
  - id: rebuild-ffmpeg-frontend
    title: Build the JavaScript FFmpeg and ffprobe shims
    prompt: |
      Build FFmpeg/ffprobe shims in packages/media-cli, using the pinned native build
      and source/dependency registers. Read applicable AGENTS.md. JavaScript understands
      option arity/scope and path-bearing syntax for dependency discovery and transfer;
      stock native binaries own command validation, processing, diagnostics and exit status.
      Preserve original argv bytes, order, empty arguments and shell-expanded values.
      Cover input/output option groups, stream specifiers, presets, option-file indirection,
      filter scripts, URLs, pipe/fd forms, sequences and output patterns. Treat metadata-
      dependent dependencies as deferred runtime reads rather than running ffprobe twice.
      Use source-informed grammar and versioned option metadata with drift checks; decide
      licensing before copying source-derived tables. Help alone is not complete grammar.
      A discovery miss must reach the late-access path; do not reject a native-valid
      command because a predictive resolver lacks a case. Transport/auth failures remain
      explicit remote errors. Native-invalid options must retain native error timing.
      Test -ss placement, multiple outputs/codecs, optional/negative maps, duplicate -y/-n,
      empty arguments, raw bytes, leading-dash names and missing late resources. Check
      predicted dependencies independently, then differential-test the whole shim against
      the native binary. Preserve partial output effects. Full command compatibility is
      required; passing through argv alone does not prove file or stream correctness.
      Use TDD with fast in-memory units and separate opt-in native integration.
    status: open
  - id: rebuild-imagemagick-frontend
    title: Build the JavaScript ImageMagick shims
    prompt: |
      Build ImageMagick shims in packages/media-cli against the pinned native build.
      Read applicable AGENTS.md and source/dependency registers. Parse ordered settings,
      parentheses, aliases and path-bearing operands for dependency discovery. Stock
      ImageMagick owns its image list, expression evaluation, validation and processing.
      Do not duplicate its runtime image state or introduce a custom native operation ABI.
      Preserve original argv, + and - forms, selectors, coder prefixes, script tokens,
      @lists/text, fonts/profiles, mpr registers, -write and implicit final output.
      Track enough grammar to identify likely resources and output effects; defer names
      requiring decoded metadata or native expressions to the runtime filesystem bridge.
      Predictions cannot replace observed effects or cause eager validation errors.
      Account for identify, mogrify, compare, montage/composite and installed aliases.
      Respect actual filesystem-sensitive classification at discovery call sites without
      asserting that JS can prevalidate the full command. Include the hidden -concatenate
      path and its input deletions in effect accounting. Keep synthetic sources distinct
      from files. Test nested groups, literal brackets, caption:@text.txt, fonts, scripts,
      multiple -write operations before failure, in-place edits and compare exit status.
      Native invocation tests must verify diagnostics, order and partial effects; parser
      unit tests verify discovery independently. No skipped native-valid family can be
      called fully supported. Use TDD and fast in-memory unit tests.
    status: open
  - id: implement-dependency-resolution
    title: Resolve nested and dynamic dependencies with upstream path rules
    prompt: |
      Implement the JS dependency resolver for the rebuilt ffmpeg/ffprobe/ImageMagick
      frontends. Read applicable AGENTS.md and docs/remote-media registers. Preserve
      ordered evaluation, original path spelling and per-reference resolution base;
      do not assume all relative paths are relative to cwd. Use actual grammars for
      concat manifests, HLS/DASH manifests, filters, scripts, presets and filename
      expressions. Distinguish path, URL, file protocol, pipe/fd, synthetic source,
      output pattern, font/resource lookup, glob and image/frame selector.
      Cover nested playlists, HLS keys/init segments, relative URL bases, subtitles,
      drawtext text/font files, LUTs, movie/amovie filters, ICC profiles, @file content,
      delegates and image sequences. Preserve signed URLs, query/fragment semantics
      and protocol policy; do not upload HTTP URLs as local paths or rewrite signed
      content casually. Trace resolution through symlinks without lexical '..'
      simplification that changes meaning. Detect cycles and enforce explicit budgets
      without truncating dependencies and claiming success.
      Produce an access graph with read/write/read-write roles and ordered timing,
      not just a set of filenames. Prefetch must not expose errors earlier, consume
      stdin, execute delegates or alter outputs. Runtime discovery supplements static
      parsing for frame-time reloads and data-dependent paths; mark such nodes live.
      Test collisions, shared nested dependencies, changing manifests, case-sensitive
      names, Unicode/newline names, nonexistent optional files and input/output aliasing.
      TDD uses original in-memory fixtures; qualify discovery against native access
      traces as evidence, not a product dependency or a dry-run replay algorithm.
    status: open
  - id: preserve-network-resource-semantics
    title: Preserve network identity and nested protocol behavior alongside uploads
    prompt: |
      Read applicable AGENTS.md, docs/remote-media/hls-redirect-oracle.json and the
      selected release's libavformat protocol/HLS/DASH implementations. Implement
      resource classification in media-cli and endpoint transport capabilities in
      remote-execution. Keep network URLs out of filesystem materialization manifests.
      Preserve original URL bytes and native request options; use direct sandbox
      network execution when its network context is the intended endpoint context.
      When caller-local connectivity is required, provide an explicitly admitted
      transport relay preserving the relevant stream/datagram semantics and endpoint
      identity; do not silently reinterpret localhost as the sandbox or implement all
      protocols through HTTP fetch. TLS, DNS, proxy, bind/listen and certificate context
      must be defined and qualified. An unavailable endpoint capability remains a gap.
      Keep native protocol access at its native execution stage. Do not fetch every
      discovered URL speculatively, consume single-use URLs twice, copy credentials
      across origins by assumption or append parent query strings to child references.
      The recorded native fixture resolves a segment against the redirected playlist
      location and preserves its custom same-origin header. Independently test redirects,
      cross-origin headers/cookies, signed queries, byte ranges and seek, changing live
      playlists, keys/init segments, retries, network failure, UDP boundaries and listen
      mode. Use synthetic credentials and local opt-in native oracles, plus fast mocked
      unit tests. Verify direct and relayed provider paths separately. A rewritten
      localhost HTTP URL or uploaded snapshot is not full network compatibility.
    status: open
  - id: define-directory-materialization-manifest
    title: Define the explicit upload-to-directory manifest contract
    prompt: |
      Define remote-execution/protocol manifests for uploading identified dependencies
      and materializing their exact logical directory tree before native execution.
      Read applicable AGENTS.md, safe-fs contracts and docs/remote-media/contracts.md.
      Each manifest binds session, revision, logical root/cwd, source authority and
      entries for directory, file and symlink, with file blob references, byte size,
      integrity and observed version/retained identity. Distinguish immutable, revalidate-
      on-open and live dependencies. Preserve original argv separately from manifest
      paths. Logical-to-physical mapping is server-owned and never changes nested
      relative references or exposes remote scratch paths in native diagnostics.
      Define raw-byte path encoding, collisions, duplicates, empty dirs, timestamps/modes
      where supported, symlink targets, hardlink identities and output-intent entries.
      Output intent must not create/truncate a user file or missing canonical parent.
      Specify missing blob, wrong length/hash, stale revision, concurrent manifests and
      partial materialization status. A ready directory revision is not proof a mutable
      source is still current at native open; retain live/revalidation callbacks.
      Use original nested concat/filter-font/ICC/image-sequence examples with cwd and
      expected tree. Test manifests independently from tool parsers, including REST/SDK
      callers with no CLI. No arbitrary server destination paths or blanket read authority.
    status: open
  - id: implement-resumable-upload-api
    title: Implement binary upload, integrity and resumable transfer API
    prompt: |
      Implement remote-execution upload client/server endpoints from the shared protocol.
      Read applicable AGENTS.md and docs/remote-media/contracts.md. Expose upload session
      creation, binary chunk transfer with offsets, resume/status, finalize and abort,
      returning a scoped verified blob handle. Accept API/SDK uploads independently of
      media CLI invocation. Default to streaming bytes, not base64 video in JSON.
      Bind handles to tenant/session and declared size/digest, validate actual bytes,
      reject mismatched overlapping chunks and distinguish identical retries from new
      writes. Bound allocations/concurrency and preserve cancellation/backpressure.
      Incomplete blobs cannot be materialized as complete inputs. Restart/resume may
      reuse acknowledged chunks but must not falsely advertise process/job durability.
      Read only authorized canonical descriptors. Source mutation/identity replacement
      invalidates a stale manifest according to the selected freshness contract. Support
      large files without JS safe-integer offset loss; use a versioned integer encoding.
      Test zero length, exact limits, very large simulated sizes, reordered/duplicate/
      truncated/corrupt chunks, authentication expiry, cancellation and cross-tenant
      handle access with in-memory transports. Real provider upload limits require
      separate integration evidence. No host files in unit tests.
    status: open
  - id: implement-directory-materialization-api
    title: Materialize the correct directory tree through a public API
    prompt: |
      Implement an explicit POST /v1/sessions/{id}/materializations operation and status/
      inspection APIs in remote-execution/server, plus portable client methods. Read
      applicable AGENTS.md and the shared materialization manifest contract. Accept a
      manifest of verified uploaded blob handles and directory/symlink entries, build
      an isolated physical tree, verify its contents, and return a materialization ID,
      revision, logical root/cwd and ready/failed status. Native jobs bind this identity.
      Preserve directory hierarchy rather than flattening files by basename. Materialize
      /work/edit/lists/cut.ffconcat and /work/clips/part one.mp4 so ../../clips from the
      list resolves exactly as on the source. Include filter scripts, font directories,
      profiles, empty directories and symlink-relative paths. Preserve original data.
      Preflight uploads/tree admission without creating command output effects. Do not
      create a missing canonical output directory just because mkdir -p is convenient.
      Prevent escapes and TOCTOU symlink swaps while preserving admitted in-scope
      relative symlinks. Reject duplicate/conflicting entries, missing blobs, invalid
      hash/size, unauthorized destinations and unsupported identity guarantees.
      Stage incomplete physical trees privately; mark ready only after verification,
      without claiming a multi-file canonical output transaction. Report readiness and
      integrity failures separately from native command errors; speculative prefetch
      failures become native-visible only at the equivalent semantic access point.
      Test API-only upload -> materialize -> inspect -> execute and wrong-cwd variants.
      Use TDD and original in-memory unit fixtures; server integration may use owned
      scratch files outside unit discovery.
    status: open
  - id: bind-jobs-to-materialized-workspaces
    title: Bind job execution and late dependencies to the right workspace revision
    prompt: |
      Implement job/materialization binding in remote-execution and media-cli's engine
      adapter. Read applicable AGENTS.md and docs/remote-media/contracts.md. A job names
      its session, ready materialization ID/revision, logical cwd, original argv, build
      identity and source filesystem capability. Reject cross-session, stale or incomplete
      bindings before process admission. Do not infer cwd from a filename or reuse the
      previous job's directory. Preserve absolute/relative names in native process view.
      Augment a running workspace through authenticated late-file requests that carry
      job/file identity and access stage. Do not rebuild the directory under open native
      handles or rerun the process. Revalidate live inputs and preserve canonical writes,
      retained identity, access errors and concurrent reader visibility. Server scratch
      staging must not become an unqualified independent filesystem authority.
      Test two jobs with identical relative paths but different sessions, concurrent
      manifest revisions, same-source aliases, cancellation during materialization,
      late nested playlist dependencies, rename/unlink after open and lost callbacks.
      No process starts while the required admitted starting tree is incomplete; this
      must not turn speculative dependency preflight into eager user-visible failures.
      Record which readiness work is metadata-only, speculative or logically required.
    status: open
  - id: implement-canonical-materialization
    title: Materialize files without changing canonical filesystem semantics
    prompt: |
      Implement remote-execution file materialization over the caller's canonical
      safe-fs FileSystem and retained descriptors. Read applicable AGENTS.md,
      packages/safe-bash/src/contracts/filesystem-descriptor.ts and safe-fs contracts.
      Remote scratch files are execution materializations, not a replacement source
      of filesystem authority. Preserve logical paths in a scoped server namespace
      wherever possible; any unavoidable rewriting uses grammar-owned path nodes,
      never string replacement inside argv/diagnostics. Preserve source content.
      Implement binary bounded/resumable transfer, integrity, explicit file identity
      and freshness, sparse/random access where promised, directory metadata/listings,
      symlink behavior and per-path read-only/mount/quota capabilities. Content-hash
      caching requires a validated object identity/version; a hash of yesterday's
      pathname does not authorize today's read or another tenant's access.
      Reads must match upstream access time. Do not freeze live drawtext/playlist
      resources through eager snapshots. Honor already-open identities after rename,
      unlink or pathname replacement; propagate short reads and exact error stages.
      Route write/truncate/append/rename/unlink effects to canonical storage with
      measured visibility and acknowledgment semantics. Completed canonical writes
      survive later command failure. Do not make all writes atomic at successful exit
      or roll them back contrary to native behavior. Preserve existing outputs on
      refused -n but reproduce early truncation when the native oracle demonstrates it.
      Test shared mounts, read-only backends, delayed/partial operations, quota exhaustion,
      mid-upload mutation, in-place mogrify, EXDEV and simultaneous reader/writer jobs.
      Never advertise capabilities that depend on unavailable backend guarantees.
    status: open
  - id: implement-full-server-api
    title: Implement the portable native-media server and complete execution API
    prompt: |
      Implement the media server and its versioned API from docs/remote-media/contracts.md.
      Read applicable AGENTS.md. Ship pinned executable/container digests, codecs,
      coders, delegates, fonts, profiles and policy/config identity. Only the explicitly
      configured remote server launches native binaries; virtual local commands do not.
      Expose authenticated sessions, resumable uploads, file metadata/listing/range
      reads, dependency requests, execution create/status/attach, stdin/EOF, stdout/
      stderr, descriptor channels, signals/cancellation, output effects and cleanup.
      Provide OpenAPI for HTTP plus a separate versioned binary-stream schema and
      matching SDK. No endpoint-per-filter API or arbitrary shell-string execution.
      Execute tool/argv/cwd/env through a real process API with safe argv handling.
      Preserve original argv tokens and ordered invocation semantics; server checks
      that the JS frontend contract and native build match before side effects.
      Support multi-output runs, delegates, process groups, file access hooks and
      native diagnostics without buffering whole videos or mixing protocol logs into
      tool streams. Record process exit separately from completed I/O settlement.
      Bind file handles, jobs and credentials to tenant/session/invocation authority.
      Validate sizes and capabilities before allocation; network URLs/delegates retain
      explicit policy. Report configured policy differences rather than claiming all
      native features work while silently blocking them. Use TDD, in-memory transport
      tests and explicit disposable-container integration for real process execution.
    status: open
  - id: implement-process-and-stream-semantics
    title: Preserve binary streams, descriptors, signals and invocation lifecycle
    prompt: |
      Implement remote process semantics in JS using safe-bash CommandContext,
      ByteSource/ByteSink, stdinInput, signal, registerCleanup and owned-output contracts.
      Read applicable AGENTS.md and docs/remote-media/contracts.md. Use binary framed
      bidirectional transport with stream IDs, per-stream offsets/credits and bounds.
      Preserve stdin/stdout/stderr separation, EOF versus no data, partial writes,
      slow consumers, early pipe closure and broken-pipe behavior. Do not use PTYs for
      binary media pipes or claim a WebSocket supplies backpressure automatically.
      Qualify noninteractive stdin, supplied ffmpeg q/overwrite responses, EOF,
      -nostdin, -progress pipe:2, pipe:0/1 and extra descriptors such as pipe:3.
      Supply missing descriptor support through the shell contract task. Do not inject
      -nostdin or overwrite flags to avoid implementing native stdin behavior.
      A seekable redirected file and a nonseekable pipe are different inputs; do not
      download an entire pipe into a seekable file to hide native ESPIPE behavior.
      Forward supported signals and terminate/reap delegate process groups. Map signal
      termination to the shell's real exit contract, not invented signal fields.
      Preserve a native process's explicit exit code, including codes from its signal
      handlers. Only project actual signal-only termination through the shell's established
      signal-status convention; do not overwrite native statuses with 128+signal blindly.
      Add native stdin oracle cases without -nostdin: finite yes/no responses, EOF,
      idle input followed by cancellation, and competition with media bytes on stdin.
      Keep stderr available when stdout closes. Register cleanup before acquisition;
      wait for owned effects and cleanup before settlement and suppress late writes
      after finalization without discarding effects already acknowledged canonically.
      Test concurrent ffmpeg producer | ffmpeg consumer, pipe capacity deadlocks,
      cancellation while blocked on remote dependency/read/upload and a successful
      subsequent invocation. Required descriptor facilities must be implemented and
      qualified before completion; terminal emulation is outside this noninteractive shell.
    status: open
  - id: implement-job-recovery
    title: Recover transport interruptions without replaying command side effects
    prompt: |
      Implement versioned remote job state and reconnect behavior from docs/remote-media/
      contracts.md. Read applicable AGENTS.md. Use client-generated invocation identity
      with payload/build binding, monotonic event sequence, durable accepted/running/
      process-exited/io-settled states and bounded acknowledged stream retention.
      A retried create with the same identity attaches to the accepted invocation;
      conflicting payloads fail. A transport reconnect does not start native execution
      again. Define sandbox-loss/unknown-outcome states and explicit recovery actions.
      Do not claim exactly-once execution after container/durable-state loss, and do
      not turn native success into shell success before required I/O has settled.
      Cover disconnect before acceptance, after acceptance before reply, during input
      upload, after native exit before output acknowledgment, during cancellation and
      during final publication. Define cancellation/exit race linearization and effect
      receipts without pretending completed writes can always be rolled back.
      Preserve already delivered stream bytes without duplication. If a resume cursor
      has expired, return an explicit unrecoverable transport result instead of
      silently losing output. Keep timeouts/deadlines independent from polling waits.
      Test races using deterministic in-memory schedules, interrupted chunk integrity,
      expired credentials, cleanup TTLs, process-group leaks and partial output recovery.
      Never classify failed or unavailable transport/provider cases as native tool errors.
    status: open
  - id: expose-output-effects-api
    title: Expose output trees and partial effects without hiding native failure
    prompt: |
      Implement output/effect inspection and retrieval API in remote-execution, consumed
      by media-cli's canonical filesystem adapter. Read applicable AGENTS.md. Track
      created/modified/removed/renamed files, generated directories, retained identities,
      ordered bytes and settlement receipts, including auxiliary passlogs, HLS segments,
      ImageMagick -write intermediates and in-place replacements. A job may have zero,
      one or many output files and binary stream output at the same time.
      Return partial effect manifests after native error/cancellation and separate native
      exit from remaining transfer failure. Generic API-only callers must be able to
      retrieve files and reconstruct the output directory while the CLI uses live canonical
      effects where required for parity. Download-on-success alone is not CLI equivalence.
      Do not glob the whole shared directory or include prior/unrelated output files.
      Test range download, interrupted resume, output rename/unlink while retained,
      consumer closure, destination quotas/read-only errors and effects produced before
      later failures. No completed canonical write rollback or implicit multi-file atomicity.
      Use in-memory unit tests and independently verified native failure examples.
    status: open
  - id: integrate-cloudflare-provider
    title: Run and qualify the portable server in Cloudflare Sandbox
    prompt: |
      Integrate Cloudflare Sandbox using the generic remote-execution driver contract
      and declarative provider configuration. Read applicable AGENTS.md and current
      official https://developers.cloudflare.com/sandbox/ docs. Pin an SDK release:
      stable and 1.0 preview process/transport APIs differ; do not mix their methods.
      Package the media server in the supported container image, expose its API through
      an authenticated Worker/service route, and configure lifecycle, resources and
      binary transport explicitly. Do not use public development tunnels as implicit
      production authentication. No core/provider-name branches or per-tool provider code.
      Prove native binary start, seekable files, late dependency access, binary full-
      duplex streams, process-group cancellation and canonical output visibility.
      SDK text/log streaming does not prove raw media pipe fidelity; use the server
      protocol for unsupported SDK process features. Validate any required mount or
      hook in the actual Sandbox deployment, not merely Cloudflare Containers docs.
      Measure upload/range-stream limits, cold starts, sleeping/restarts, idle versus
      running lifetimes, storage persistence, endpoint expiry and delegate cleanup.
      Optional R2 staging must preserve the canonical file contract, version identity
      and explicit transfer authority; object-store mounts do not imply POSIX parity.
      Use mocks for unit tests and a separately authorized real-cloud QA plan in
      docs/plans. No deployment or billable provisioning without an explicit execution
      authorization. Record unrun provider checks as unverified, never as passes.
    status: open
  - id: integrate-modal-and-generic-provider
    title: Qualify Modal and a generic REST server through the same client
    prompt: |
      Implement Modal deployment through the generic driver/config contract used
      by Cloudflare, plus an existing-server REST configuration needing no provider
      SDK. Read applicable AGENTS.md and official https://modal.com/docs/guide/sandboxes,
      sandbox-files and sandbox-networking documentation. Use the current filesystem
      API rather than deprecated FileIO assumptions; pin SDK/API and image versions.
      Provider definitions should require one declarative file each when existing
      driver capabilities suffice; protocol-specific driver logic stays outside core.
      Run the same portable server/API and same JS frontend for every provider.
      Qualify endpoint authentication, readiness, lifetimes, volume/file behavior,
      full-duplex binary streams, cancellation, dynamic dependencies and output effects.
      Distinguish standard Modal Sandboxes from VM Sandboxes if a feature such as a
      custom mount requires the latter; declare selection instead of silently changing
      execution class. Provider-native exec/file APIs can bootstrap the service, not
      bypass generic execution or change command semantics.
      Reuse the identical provider conformance suite for REST, Cloudflare and Modal.
      Test expired tunnels, server restart, cold/warm jobs, large files, credentials,
      transport cuts and tenant isolation. Validate documentation/version claims by
      real authorized cloud runs; credential/resource absence blocks that evidence.
      No implicit account creation, deployment, volume creation or billing. Keep
      hardware/GPU support capability-derived, never inferred from provider name.
    status: open
  - id: integrate-cloudflare-worker-host
    title: Host safe-bash and the shims in a Cloudflare Worker
    prompt: |
      Add the Worker composition/deployment entrypoint under packages/media-cli/deploy,
      using the workerd safe-bash export and portable media-cli/remote-execution client.
      Read applicable AGENTS.md. The existing src/sdk/bash.ts is a Node entrypoint;
      do not import its host filesystem or process dependencies into the Worker.
      Inject mediaCommands({ engine }) into Shell with an explicit canonical filesystem.
      Expose an authenticated command/job route; derive session isolation from caller
      identity. The Worker-compatible Cloudflare adapter uses the Sandbox binding to
      reach the container API. Node-only process launch remains inside the container.
      Pin one Sandbox SDK version and configure its Durable Object/container binding.
      Define whether an application Durable Object owns each live shell/job session,
      plus storage for accepted job identities, stream offsets and effect receipts.
      A Sandbox lifecycle Durable Object does not automatically persist the shell.
      Bound Worker memory with streaming/chunk credits. Use scoped direct blob transfer
      when supported by the canonical backend; streamed Worker transfer remains valid
      when bounded. No whole-video arrayBuffer or broad storage credentials in jobs.
      Qualify disconnect/reconnect, Worker restart, long-running jobs, cancellation,
      byte limits and backend persistence. Do not promise in-memory shell continuation
      after restart without a demonstrated recovery mechanism. R2 is object storage;
      required filesystem semantics need an enforcing adapter and must be qualified.
      Test workerd import closure, a real Worker-to-Sandbox media command, binary pipes
      and file effects. Cloud runs need explicit execution authorization; unrun checks
      remain open. Keep all host code within the two selected packages and root wiring.
    status: open
  - id: wire-public-cli-and-sdk
    title: Expose native command names with matching public SDK configuration
    prompt: |
      Wire the rebuilt JS media frontends as an explicit safe-bash plugin using
      packages/safe-bash/src/contracts/plugin.ts, command.ts, core.ts and existing
      registration/collision policies. Read applicable AGENTS.md. Use native command
      spellings ffmpeg, ffprobe and inventoried ImageMagick commands; do not replace
      them with media --input/--output syntax or require dependency declarations for
      ordinary native commands. Implement tool-aware shims in media-cli, not root CLI code.
      Expose identical remote service/provider/auth/build/resource settings through
      public SDK and src/sdk/bash.ts plus src/cli/commands/bash.ts. CLI calls SDK.
      Keep provider settings outside forwarded native argv so original option names
      do not collide. Supply configuration through SDK options or explicit CLI args;
      media commands must not introduce interactive configuration prompts.
      No implicit cloud connection in normal agentCommands.
      Preserve getCommandArguments byte fidelity, env/cwd, pipeline semantics and
      backend capabilities. Shell owns expansion/redirection; media frontend owns
      native tool grammar. Prove executable script/heredoc and SDK argv invocations
      behave equivalently. No native local process fallback and no Python requirement.
      Native help/version/capability output must match the pinned remote build; never
      return fabricated local cached help for an incompatible server. Transfer progress
      uses host design-system events outside native streams. Test screenshots of help,
      configuration failures and progress via npm run screenshot-poe-code -- <command>.
      Run public-consumer/export tests and preserve browser/Node dependency boundaries.
    status: open
  - id: verify-api-only-workflow
    title: Verify full upload and materialization workflow without the CLI
    prompt: |
      Write and execute an integration conformance procedure for the public REST/SDK API
      alone, separately from ffmpeg/magick shims. Read applicable AGENTS.md. Create session,
      upload all nested dependency blobs, submit a directory manifest with original cwd,
      inspect verified materialization, execute original argv, stream output, inspect
      process/effect status, retrieve the output tree and clean up. Use a concat list
      and subtitle/font or ImageMagick caption/profile fixture, not just one input file.
      Verify schema examples against real request/response validators and server routes.
      Cover missing upload, corrupt digest, incomplete revision, conflicting basename,
      wrong cwd, empty dirs, unauthorized symlink escape, replayed job identity and a
      native failure that leaves output. Repeat with generic REST, authorized Cloudflare
      and authorized Modal servers; mocks do not count as cloud evidence.
      Store manual QA plan under docs/plans and bounded request/effect evidence under
      docs/remote-media, excluding credentials and media payload dumps. No cloud spend
      or deployment without separate authorization. Generated management clients may
      use toolcraft-openapi only where actual streaming/encoding semantics match; the
      native CLI frontend remains handwritten source-driven JS.
    status: open
  - id: execute-sophisticated-media-corpus
    title: Verify complex native commands and dependency behavior end to end
    prompt: |
      Build and execute an original conformance corpus for the JS media frontend
      and remote server. Read applicable AGENTS.md and docs/remote-media registers.
      QA procedures belong in docs/plans, fixtures/evidence in docs/remote-media or
      the maintained integration owner. Native runs are explicit opt-in integration;
      fast unit tests use memfs and never create host files or query an LLM.
      Include FFmpeg multi-input overlay plus subtitle/font dependency, two differently
      encoded outputs, concat with spaces/nested relative files, image sequences with
      gaps, filter scripts loading LUT/text files, two-pass passlogs, HLS/DASH nested
      manifests with key/init segments, tee/segment output sets and dynamic reload.
      Include FFmpeg binary producer-consumer pipelines, ffprobe JSON sections,
      seek-before/after input, optional/negative maps, lossless alpha and metadata.
      Include ImageMagick nested settings/clone groups, GIF coalesce/optimize/disposal,
      ICC conversion with embedded/explicit profiles, caption:@text plus font, TIFF
      selectors, multi-write/filename expressions, scripts and mogrify in-place failure.
      Expected behavior comes from pinned native oracles. Compare exact deterministic
      bytes/status/effect traces and decode media for nondeterministic encoders; bind
      tolerances to fields, never normalize away missing frames, errors or paths.
      Verify video frame counts/timestamps/audio sync, image alpha/colors/orientation,
      output dependencies/metadata, and inspect rendered frames/contact sheets visually.
      Add missing/corrupt dependency, insufficient permission/quota, protocol refusal,
      unusual filenames, symlink aliases and failure after partial output for each family.
      Every example needs manifest, expected dependency/access order, result/effect
      assertions, provider/build identity and actual executed status; none passes by parsing.
    status: open
  - id: verify-adversarial-lifecycle-and-performance
    title: Stress concurrency, faults, resource bounds and compatibility drift
    prompt: |
      Verify the complete JS media/frontend/server integration under resource and
      lifecycle pressure. Read applicable AGENTS.md, canonical contracts and
      docs/remote-media evidence. Test byte ownership against producer buffer reuse,
      delayed reads/writes, many small files, deep/cyclic manifests, very large inputs,
      sparse seeking, ZIP/delegate expansion, image/decode bombs and huge output counts.
      Bound transfer buffers, native CPU/memory/disk, open files and job admission using
      actual enforceable server/provider controls. Do not report bridge byte limits
      as whole-process memory limits. Shared job admission must not deadlock pipelines.
      Test tenant isolation, unauthorized path/delegate/network access, TOCTOU path
      replacement, output symlink escape, cache guessing, callback spoofing, credentials
      in URLs and interrupted cleanup. Retain permitted native semantics; policy changes
      must appear in build/capability identity and compatibility results.
      Fault every lifecycle boundary: before/after acceptance, during nested-file fetch,
      seek/write/rename, stdin EOF, early consumer exit, SIGINT, native exit, final I/O
      acknowledgment and provider loss. Preserve partial effects and truthful unknown
      outcomes; never automatically rerun mutating commands.
      Measure cold/warm time, transferred bytes, read amplification, memory/disk,
      caching, large-video throughput and streaming latency with stated inputs and
      hardware. Add drift gates for upstream option tables, binary/config identity and
      provider SDK changes. Keep benchmark/performance claims separate from parity.
    status: open
  - id: reconcile-full-compatibility-and-document
    title: Audit every command family and publish truthful usage and qualification
    prompt: |
      Audit docs/remote-media registers against the user's full-compatible JavaScript
      frontend requirement with native processing on a generic remote sandbox server.
      Read applicable AGENTS.md. Account for every option/parser/resolver family,
      process/filesystem effect, dependency source, API operation and advertised
      provider. Test JS dependency discovery independently and whole-shim behavior
      against stock native execution. Forwarding argv alone does not establish parity;
      file transfer, runtime dependencies, streams and effects must all be exercised.
      Unknown options, unimplemented dynamic dependencies, unavailable devices/GPU,
      required descriptor differences and unrun cloud cases remain explicit blocking gaps
      for the relevant full-compatibility claim. Do not shrink the register to get green.
      Complete maintained focused checks and full npm test/lint/build for cross-package
      integration with maintained uncached dependency closure; lint:workflows for
      workflow changes without workflow unit tests. Inspect changed CLI screenshots
      and representative image/video results, not only machine summaries.
      Write SDK/API/deployment/usage docs outside README until authorized, including
      all config/env variables, authentication, native build requirements, caching,
      failure recovery and sophisticated reproducible examples. Validate OpenAPI and
      binary protocol examples against the same implementations clients consume.
      Keep all plan steps open until their evidence gates pass. Report delivered versus
      blocked behavior and actual provider scope. No automatic commits/push/releases
      or billable deployment. If later authorized, stage only owned files, make atomic
      conventional commits on main and separately monitor remote-main/release delivery.
    status: open
---

# JavaScript media CLI with native execution in remote sandboxes

## Scope

Build JavaScript FFmpeg/ffprobe and ImageMagick shims for safe-bash. Native
media processing runs in Cloudflare Sandbox, with Modal and generic REST support.
Preserve CLI grammar, nested dependencies, directory layout, streams and file effects.
Target noninteractive safe-bash. All required noninteractive shell and media semantics
must pass qualification; missing support is work to complete, not a scope exception.

Planning only. Implementation and deployment are deferred. All 29 tasks are stepless.

## Architecture and ownership

```mermaid
flowchart LR
  S[Shell argv and streams] --> J[JavaScript CLI parser and ordered execution model]
  J --> D[JavaScript dependency resolver and canonical filesystem owner]
  J --> C[Generic remote execution client]
  D <--> C
  C <-->|Versioned API and binary streams| R[Sandbox media server]
  R --> N[Native FFmpeg and ImageMagick engines]
  N --> F[Runtime file access requests]
  F --> R
  P[Cloudflare or Modal or existing REST server] -. lifecycle .-> R
```

Selected structure: **two new packages**, using the existing safe-fs and safe-bash
contracts. Protocol and server code are separated by subpath exports rather than
another workspace. Package/API spellings below are proposed, not existing exports.

| Owner | Responsibility |
| --- | --- |
| `media-cli` | JS command shims, dependency parsers/resolvers, native version/option manifests and media-specific server bootstrap/image |
| `remote-execution` | Shared protocol, portable client, uploads/materialization, job/file/stream semantics, Node server and isolated provider drivers |
| safe-bash plugin | Adapt existing command/stream/filesystem contracts; register explicit native command names |
| root SDK/CLI | Public configuration and wiring only |

Provider configuration is declarative. A new provider using an existing transport
driver should require one definition file, with no switches elsewhere. Truly new
transport behavior belongs in a reusable driver; tool grammar must never depend
on provider identity. No speculative universal plugin framework is needed.

Current integration seams inspected: `contracts/command.ts` and
`getCommandArguments`, `contracts/plugin.ts`, `contracts/output.ts`,
`contracts/filesystem-descriptor.ts`, safe-fs canonical contracts, `core.ts`,
`src/sdk/bash.ts` and `src/cli/commands/bash.ts`. Existing Python configuration is
not a media frontend and must not become the implementation owner.

```text
packages/
  media-cli/
    src/
      index.ts                 # portable media execution SDK
      ffmpeg/                  # shim, option scope and dependency resolution
      imagemagick/             # shim, ordered path syntax and file resolution
      dependency-graph/        # media-specific dependency evaluation
      tool-definitions/        # pinned native command/build/capability descriptions
      server.ts                # composes remote-execution/server with media tools
    deploy/                    # media container image and provider entrypoints
    README.md                  # draft first; addition requires user's permission
  remote-execution/
    src/
      protocol/                # common validation and HTTP/binary schemas
      client/                  # platform-neutral sessions/jobs/files API
      transfer/                # uploads, manifests, integrity and revalidation
      jobs/                    # ordered effects, stream ownership and recovery
      server/                  # Node-only HTTP/WS, native process and materialization
      providers/               # declarative definitions and protocol-specific drivers
    README.md                  # draft first; addition requires user's permission
  safe-bash/
    src/commands/media/        # thin injected CommandDefinition adapter only
```

Dependency direction is `media-cli -> remote-execution`. The generic server receives
tool definitions; it never imports media-cli. The media server entrypoint imports
`remote-execution/server` and supplies the tool configuration. The root SDK injects
the constructed engine into safe-bash; safe-bash imports neither new package as an
implicit runtime dependency. This follows the existing injected-engine pattern
without copying the PPTX adapter's whole-file buffering into media pipelines.

`remote-execution/protocol` and `/client` must import no Node/process/provider SDK
code. `/server` is Node-only. Provider SDK dependencies belong behind explicit
provider imports. This supports browser-side clients without bundling a server
and avoids circular dependencies or a third contracts package.
A separate Worker-compatible provider export holds the Cloudflare Sandbox binding
adapter. Container-only dependencies must never enter that import graph. The generic package
implements the execution features required here, not an unrelated orchestration framework.

Existing alternatives inspected and deliberately not adopted wholesale:

| Existing package/file | Reuse decision |
| --- | --- |
| `agent-harness-tools/src/execution-env.ts` | Agent runtime/config/job orchestration and host/docker selection; do not couple portable media to it |
| `process-runner/src/types.ts`, `host/host-runner.ts` | Consider only for server-side native process launch; qualify spawn errors, signal exit and termination escalation before reuse |
| `process-runner/src/workspace-transfer.ts` | Whole-workspace, host/Buffer-oriented transfer does not provide canonical dependency-only materialization or live effects |
| `toolcraft-openapi/src/http.ts` | Current binary response collection/base64 and multipart buffering are unsuitable for media streams; optional administrative clients only where qualified |
| `safe-bash/src/commands/pptx/index.ts` | Useful dependency-injection boundary; buffered artifact publication and atomic-edit requirements are not media stream semantics |

## Design constraints that decide correctness

1. **Original grammar, not filename guessing.** Parse ordered FFmpeg option groups
   and ImageMagick path-bearing syntax for discovery. Native tools retain execution
   and validation authority. Derive versioned metadata from pinned
   source and native capability tables. Use real parsers for embedded languages.
2. **One authoritative filesystem.** Remote local files are temporary materializations.
   Canonical storage defines rights, identity, access errors and visible effects.
   A synchronization shortcut must not change semantics silently.
3. **Preserve error and effect order.** Finding an invalid later dependency during
   prefetch must not change an earlier native error, prompt or output side effect.
   Preflight discovery cannot become permission to eagerly open/truncate everything.
4. **Runtime dependencies remain required.** Static resolution cannot fully replace
   accesses triggered by decoded metadata, reloads, delegates or changing playlists.
   Prove a server file-request hook that lets JS resolve and materialize them at the
   actual access stage. A failed command restarted after copying a file is not equivalent.
5. **Preserve ordinary command spellings.** No special user-authored input manifest
   for commands that work natively. Operational configuration belongs to the plugin/SDK,
   outside native argv. Shell expansion/redirection is performed once by the shell.
6. **No unearned compatibility.** Same codec build, font assets, locale, policy and
   delegate availability are part of the oracle identity. Hardware, local devices,
   network locality and descriptor gaps cannot be erased by passing a file test.
7. **Native execution stays remote.** Existing rules prohibiting local native process
   escape remain intact; the user explicitly authorizes the remote-native architecture.

The native executable is authoritative for command validation and media processing.
JavaScript parses for dependency discovery and remote transport; independently test
that discovery and compare the complete shim with native execution. Dependencies
whose names depend on decoded media are discovered through runtime file access,
not a second JS image-processing state machine or custom native media ABI.

## Proposed API outline

These endpoints are a design sketch to validate in the contract task, not shipped APIs.

| API operation | Essential behavior |
| --- | --- |
| `GET /v1/capabilities` | Protocol/native build, option-table/config identity, codecs/coders/delegates, resource and provider capabilities |
| `POST /v1/sessions` | Scoped workspace and lifecycle; no global shared writable directory |
| `POST /v1/sessions/{id}/uploads` | Resumable binary upload with identity/integrity and bounded chunk sizes |
| `PUT /v1/sessions/{id}/uploads/{uploadId}/content` | Binary chunks with declared offsets and acknowledged progress |
| `POST /v1/sessions/{id}/uploads/{uploadId}/finalize` | Verify size/hash, return a session-scoped complete blob handle |
| `POST /v1/sessions/{id}/materializations` | Build and verify the exact directory tree from an explicit manifest and uploaded blobs |
| `GET /v1/sessions/{id}/materializations/{materializationId}` | Readiness, revision, logical cwd and materialization errors |
| `GET /v1/sessions/{id}/files` | Scoped listing/metadata, not an unrestricted server filesystem browser |
| `POST /v1/jobs` | Idempotency identity plus original argv, ordered invocation, cwd/env and stream/file bindings |
| `GET /v1/jobs/{id}` | Accepted/running/exited/I/O-settled/unknown outcome with actual process status |
| `GET /v1/jobs/{id}/stream` | WebSocket upgrade for binary stdin/out/err, fd channels, dependency requests and acknowledgments |
| `POST /v1/jobs/{id}/signals` | Explicit signal/cancellation and acknowledgment; HTTP abort is not process termination |
| `GET /v1/jobs/{id}/outputs` | Effect/partial-output manifest, retained identity and settlement status |
| `GET /v1/sessions/{id}/files/{handle}/content` | Authorized range/binary retrieval tied to retained object identity |
| `DELETE /v1/sessions/{id}` | Defined cleanup after ownership settles; never discard acknowledged canonical writes |

REST and provider-native bootstrapping coexist. Cloudflare/Modal SDKs provision
and connect to the same server; the media client need not inherit provider SDK
limitations on text logs or stdin. Use frame types for control versus media bytes,
with per-channel flow control, offsets and bounded replay. Represent raw argv/path
bytes explicitly where required; JSON strings alone do not preserve arbitrary
non-UTF8 shell values. Reject embedded NUL according to the source contract.

An execution may finish natively while output transfer remains unresolved. Preserve
those two states. A reconnect may resume the same job, but an irretrievably lost
sandbox creates an unknown/failed outcome, not a justified automatic rerun.

### Explicit upload and directory materialization workflow

The API supports this independently of the CLI:

1. Create a session and an authorized logical workspace root.
2. Upload dependency bytes, resume interrupted uploads, then finalize verified blobs.
3. Submit a manifest specifying directories, file-to-blob bindings, symlinks and cwd.
4. The server builds the private physical tree and reports a ready materialization
   identity/revision. It does not flatten basenames or invent output directories.
5. Execute a job bound to that identity, original argv and logical cwd.
6. Resolve any late dependency through the same scoped API without restarting the job.
7. Inspect outputs/effects and retrieve the correct output tree, including partial
   results when the native process fails.

Illustrative manifest; blob names and source revisions are placeholders returned
by the actual upload/source APIs, not hardcoded protocol values:

```json
{
  "logicalRoot": "/work",
  "cwd": "/work",
  "revision": "revision-1",
  "entries": [
    {"path": "edit", "kind": "directory"},
    {"path": "edit/lists", "kind": "directory"},
    {"path": "clips", "kind": "directory"},
    {"path": "out", "kind": "directory"},
    {"path": "edit/lists/cut.ffconcat", "kind": "file", "blob": "uploaded-list", "freshness": "revalidate-on-open"},
    {"path": "clips/part one.mp4", "kind": "file", "blob": "uploaded-part-one", "freshness": "revalidate-on-open"},
    {"path": "clips/part two.mp4", "kind": "file", "blob": "uploaded-part-two", "freshness": "revalidate-on-open"}
  ]
}
```

The resulting logical namespace must be:

```text
/work/
  edit/lists/cut.ffconcat
  clips/part one.mp4
  clips/part two.mp4
  out/
```

Thus `../../clips/part one.mp4` inside the list resolves correctly. A physical
job directory is an implementation detail; the native process must observe the
logical namespace consistently for both absolute and relative names. Merely
setting cwd to a prefixed physical path does not solve absolute path semantics.
The proof task must qualify the namespace mechanism and delegate visibility.

Final schemas also include verified size/digest, source authority/version and
byte-path encoding where required. This short example omits those details for
readability. The `out` directory is present because it already exists in the
canonical fixture. If absent canonically, materialization must not create it and
change a command that should fail into one that succeeds.

Directory readiness verifies physical staging, not indefinite freshness. Live or
mutable files require canonical revalidation/access mediation at the original
read stage. Upload snapshots cannot silently replace that guarantee. Manifest
revisions cannot replace files underneath native retained handles. Failed or
partly built materializations cannot start a job as a ready revision.

Directory edge cases include equal basenames in separate folders, empty directories,
input/output aliases, symlinks with in-scope `..` targets, unauthorized escapes,
case/Unicode distinctions, file/directory collisions, stale revisions, missing
blobs, partial upload, hash mismatch and concurrent jobs using the same relative
names. Building the private staging tree may be atomic internally; canonical
command effects remain ordered native effects, not a multi-file transaction.

## Sophisticated acceptance examples

These commands are proposed native-oracle fixtures, **not commands executed during
planning**. The implementation must run and correct each fixture against the selected
native build before recording a pass. Options/codecs/assets must be present in that
fixture's pinned build. Tests use original tiny media, fonts/profiles with known
licenses, private temporary workspaces and explicit remote execution authorization.
All examples also run through the public JS frontend and SDK, not only native CLI.

### A. Multiple inputs, filter graph and independent output option groups

```sh
ffmpeg -hide_banner -y -ss 1.25 -i 'clips/interview café.mp4' \
  -loop 1 -i 'assets/logo mark.png' -i 'audio/music bed.wav' \
  -filter_complex '[0:v]scale=1280:-2[base];[1:v]scale=160:-1[logo];[base][logo]overlay=W-w-24:H-h-24[v];[0:a][2:a]amix=inputs=2:duration=first[a]' \
  -map '[v]' -map '[a]' -t 4 -c:v libx264 -crf 22 -c:a aac 'out/review.mp4' \
  -map 0:a:0 -t 2 -c:a pcm_s16le 'out/dialogue.wav'
```

Assert input-index stability, -ss scope, output-specific duration/codec state,
logo placement, audio sample/timestamp behavior and both outputs. Error variants:
missing audio stream, malformed graph, missing logo and unwritable second output.
Compare which output effects exist when the second output fails; do not invent
all-or-nothing publication. Fixture input has a known audio stream.

### B. Concat dependencies resolved relative to a manifest

```text
# edit/lists/cut.ffconcat
ffconcat version 1.0
file '../../clips/part one.mp4'
inpoint 0.5
outpoint 1.5
file '../../clips/part two.mp4'
```

```sh
ffmpeg -f concat -safe 0 -i edit/lists/cut.ffconcat -c copy out/joined.mp4
```

Assert the two paths are based on the manifest location, not cwd; preserve compatible
stream headers and native timestamp behavior. Add escaped quotes, CRLF/BOM variants,
missing later entries, absolute file references, repeated file identity and cycles
where a supported nested format creates recursion. Do not assume inpoint/outpoint
stream copy produces exact frame-accurate duration. Assert against the oracle.

### C. File-loaded filter graph with secondary resources

```text
# filters/look.txt
[0:v]lut3d=file=assets/grade.cube,drawtext=fontfile=fonts/TestSans.ttf:textfile=titles/current.txt:reload=1:x=24:y=24[v]
```

```sh
ffmpeg -i clips/source.mp4 -/filter_complex filters/look.txt \
  -map '[v]' -an -c:v ffv1 out/titled.mkv
```

Assert graph-file parsing and each filter's actual resource-resolution base. Change
`titles/current.txt` through a second canonical filesystem client at a controlled
frame barrier; verify observed text changes and retained handle behavior against
native execution. Test font missing, empty text, invalid UTF-8, atomic replacement
versus partial rewrite, and escapes in filter path syntax. Do not rewrite the
graph using global string replacement or cache a live text file indefinitely.

### D. Numbered sequences and multiple output files

```sh
ffmpeg -framerate 24000/1001 -start_number 1001 \
  -i 'frames/shot_%06d.png' -vf 'fps=12,scale=320:-2' \
  'out/thumb_%04d.png'
```

Assert discovery/order of 001001 onward without uploading every matching-looking
file, output sequence naming and exact frame count. Test missing first/middle
frame, literal percent/brackets, shell-expanded versus tool-owned globs, very large
indices and output quota failure after several frames. Existing unrelated outputs
remain distinguishable from newly created files; do not collect by loose glob alone.

### E. Two-pass encoding across invocations

```sh
ffmpeg -y -i clips/source.mp4 -c:v libx264 -b:v 600k \
  -pass 1 -passlogfile 'state/two pass' -an -f null -
ffmpeg -y -i clips/source.mp4 -c:v libx264 -b:v 600k \
  -pass 2 -passlogfile 'state/two pass' -c:a aac out/twopass.mp4
```

Discover codec-generated passlog filenames and publish them canonically before the
second invocation reads them. Test stale/truncated logs, changed first-pass input,
concurrent runs using the same prefix and a failed first pass. Do not special-case
the prefix as exactly one dependency or silently reuse another job's statistics.

### F. HLS nested input and generated manifest/segment outputs

```sh
ffmpeg -i media/master.m3u8 -map 0:v:0 -map '0:a:0?' \
  -c:v libx264 -c:a aac -f hls -hls_time 1 -hls_list_size 0 \
  -hls_segment_filename 'out/seg_%03d.ts' out/index.m3u8
```

Use controlled original master/variant fixtures with relative paths, initialization
segments and an authorized encrypted-input fixture requiring a key resource. Check
manifest base URLs, segment order, live refresh, escaped/signed URLs and provider
network policy. No leaking keys or signed query credentials into evidence. Qualify
DASH and tee-muxer variants separately, including escaped nested destination options.
Observe progressive segment/manifest updates, not only final directory contents.

### G. Binary pipeline, independent stderr and nonseekable output

```sh
ffmpeg -i clips/source.mp4 -f nut -c:v rawvideo -an pipe:1 |
  ffmpeg -f nut -i pipe:0 -vf scale=160:-2 -f framemd5 pipe:1
```

Verify binary bytes never pass through text decoding, upstream backpressure and
concurrent job admission. Terminate the downstream consumer early and compare native
broken-pipe/exit effects. Test `-progress pipe:2` without merging stderr into stdout;
test a seek-required MP4 muxer on a pipe and preserve its native failure. Add extra
descriptor cases only when the host shell supplies them, retaining gaps otherwise.

### H. ffprobe structured output and option-specific parsing

```sh
ffprobe -v error -select_streams v:0 -read_intervals '1%+0.5' \
  -show_entries 'stream=index,codec_name,width,height:frame=pts_time,pict_type' \
  -show_frames -of json 'clips/interview café.mp4'
```

Compare selected fields, read-interval semantics, JSON encoding and statuses. Test
invalid writer parameters, empty selection, corrupt container metadata and missing
files. Field selection colons are grammar, not filename separators.

### I. ImageMagick nested groups, clones and multiple writes

```sh
magick 'images/source portrait.png' \
  \( +clone -resize '640x640>' -write out/preview.png +delete \) \
  -resize '128x128^' -gravity center -extent 128x128 out/avatar.webp
```

Assert clone/list lifetime, setting scope, preview before avatar, geometry semantics,
alpha and format options. Add -respect-parentheses variants, nested groups, empty
lists, mismatched parentheses and a late invalid operation after -write. Preserve
the earlier written preview when the native invocation does.

### J. Profiles, font files and text indirection

```sh
magick images/input.tif -profile profiles/input.icc -profile profiles/output.icc \
  \( -background none -fill white -font fonts/TestSans.ttf -pointsize 24 \
     -size 400x caption:@text/caption.txt \) \
  -gravity south -compose over -composite out/captioned.png
```

Fixture embeds or omits the source profile deliberately, so profile assignment
versus conversion is asserted separately. Test UTF-8 text, multiple lines, missing
glyphs, relative font paths and security policy refusing @file. Do not silently
override policy or substitute host fonts. Compare pixels with declared color
tolerances and inspect the result visually; metadata-only checks are insufficient.

### K. Animation, selectors and ImageMagick-specific status behavior

```sh
magick images/animation.gif -coalesce -resize '320x320>' \
  -layers Optimize out/small.gif
magick 'images/pages.tif[0,2]' -scene 7 'out/page_%02d.png'
magick compare -metric AE images/reference.png images/changed.png out/diff.png
```

Verify frame delay, disposal, transparency and loop metadata, not only frame count.
Test bracket selectors versus literal bracket filenames and native scene numbering.
For compare, distinguish image-difference status from execution error; a nonzero
status may coexist with a valid diff image and stderr metric. Do not discard it.

### L. In-place edits, path aliases and mid-command failure

```sh
magick mogrify -strip -resize '50%' 'images/first.jpg' 'images/second.jpg'
```

Test an unwritable/corrupt second file after a valid first file, symlink/hardlink
aliases, simultaneous readers, rename/unlink while open and temporary-file cleanup.
Compare actual per-file effects and replacement semantics with native behavior.
No blanket transactional rollback. Add script-mode fixtures using the pinned
ImageMagick script grammar to verify @ dependencies and one-token-at-a-time effects.

## Cross-cutting edge-case matrix

| Class | Required cases and observations |
| --- | --- |
| Argument fidelity | Empty arguments, repeated flags, negative numbers, native-specific -- behavior, leading-dash names, invalid UTF-8/raw bytes, NUL refusal, shell quoting once |
| Path semantics | Spaces/quotes/newlines, Unicode normalization distinctions, case sensitivity, absolute/relative paths, symlink-sensitive '..', file: URLs, coder prefixes, colons, percent/brackets, retained identity |
| Dependencies | Indirect scripts/lists, recursive references, manifests changing during execution, optional missing resources, fonts/profiles/delegates, per-format URL bases, late file reads |
| Outputs | Multiple outputs, no file output, patterns, in-place updates, shared input/output aliases, early truncation, overwrite prompts, partial failure, append/rename/unlink, sparse writes |
| Streams | Binary null bytes, short reads/writes, EOF versus idle, stdout/stderr isolation, extra fds, seekability, huge streams, slow/early-exiting consumers, shared concurrency limits |
| Lifecycle | Cancellation during every stage, SIGINT versus kill, delegates/process groups, reconnect before/after acceptance, expired replay, output settlement after process exit, lost sandbox |
| Cache/transfer | Partial chunks, hash mismatch, mid-transfer mutation, identity/version invalidation, unauthorized shared cache access, stale negative entries, offline missing bytes, range amplification |
| Backend | Memory, delayed backend, read-only, quotas, mounts, cross-mount rename, unsupported atomicity, caller capabilities unknown versus false, no host path leakage |
| Provider | Cold start/sleep/restart, endpoint expiry, interrupted credentials, networking policy, actual binary WebSockets, SDK version differences, standard versus VM capability |
| Native build | Codec/filter/coder availability, ImageMagick Q8/Q16/HDRI, font/delegate/policy differences, locales, threads/GPU nondeterminism, build mismatch before side effects |

safe-bash is noninteractive: no PTY, terminal resize or foreground terminal job control.
All required noninteractive behavior remains in scope, including extra descriptors,
stdin-driven command behavior, background execution where supported by safe-bash,
network-local endpoints and native device/GPU capabilities. Missing required support
must be implemented and qualified; a file-only subset does not complete this plan.

## Qualification and sequencing

Execution order: native inventory and contracts → package boundaries → minimal
end-to-end proof → required filesystem/descriptor contracts and shims → complete API
and providers → Worker host and SDK/CLI wiring → full compatibility corpus.
The proof may build the minimum protocol/server needed for one real round trip;
later API tasks complete that implementation. Every required behavior must be
qualified before full completion, regardless of when the first command works.


The early feasibility task prevents spending the entire project porting option
tables before proving dynamic file access and native effect ordering can work in
the chosen sandbox. The target remains JavaScript shims; a feasibility failure
does not authorize switching to a different architecture silently.

After contracts/proof: implement JS parsers and dependency resolution, canonical
materialization, server/streams/recovery, provider drivers, public surfaces and
full corpus verification. Milestones are useful progress reports, not parity claims.

Each corpus row records original fixture provenance, native build/config, original
argv and working directory, expected resolution/access/effect order, expected
status/streams/media properties, provider/backend and actual result. Native trace
tools are oracle evidence; they are not required by product users. Fast unit tests
must independently assert expected behavior rather than derive expectations from
the registry being tested. No network, LLM calls or host files in unit tests.

Compare exact deterministic bytes and statuses; for nondeterministic codecs use
decoded frames/audio, timestamps and narrow justified tolerances. Never remove
entire stderr lines or arbitrary output paths to hide semantic mismatches. Pin
locale/build where necessary. Record performance separately from correctness.

Inspect rendered frames, animations and image outputs, and CLI screenshots for
visible changes. Technical fixture imagery can be generated deterministically;
new artistic assets, if introduced, follow the user's image-reference requirement.

Full completion requires all inventoried required command families and observable
effects qualified, actual Cloudflare and Modal evidence, generic REST conformance,
public SDK/CLI parity, and maintained build/test/lint success. Unavailable providers,
unimplemented late access and unverified device/descriptor behavior are visible
blockers. Successful parser tests or native execution alone do not close the plan.

## Research evidence

[Fable review and resolved decisions](../remote-media/fable-review.md).


- [Safe-bash contract gaps](../remote-media/safe-bash-contract-findings.md)
- [Native source findings](../remote-media/native-research-findings.md)
- [FFmpeg error-ordering probes](../remote-media/ffmpeg-native-ordering-probes.json)
- [HLS redirect probe](../remote-media/hls-redirect-oracle.json)
- [Completion audit](../remote-media/completion-audit.md)

Qualify against a pinned native build, OS, filesystem backend and provider.
Check required capabilities together, including FUSE and GPU availability.

## Sources inspected and remaining investigation

Research date: 2026-09-14. Source snapshots below are not production build pins.

- [FFmpeg source snapshot](https://github.com/FFmpeg/FFmpeg/tree/639ee849526cfe61ceb312776335c245b98bd9d4): parser/option ownership to audit and pin against a selected release.
- [FFmpeg CLI](https://ffmpeg.org/ffmpeg.html), [formats](https://ffmpeg.org/ffmpeg-formats.html), [filters](https://ffmpeg.org/ffmpeg-filters.html) and [protocols](https://ffmpeg.org/ffmpeg-protocols.html): grammar and file/stream behavior starting points.
- [ImageMagick source snapshot](https://github.com/ImageMagick/ImageMagick/tree/2ed1b96b9bc71434f0c4e82e3c63fec029c684c6), [command processing](https://imagemagick.org/command-line-processing/) and [options](https://imagemagick.org/command-line-options/): ordered settings/list semantics and filename expressions.
- [Cloudflare Sandbox files](https://developers.cloudflare.com/sandbox/api/files/), [services](https://developers.cloudflare.com/sandbox/guides/expose-services/) and [1.0 preview processes](https://developers.cloudflare.com/sandbox/1-0-preview/processes/): SDK versions and transport capabilities require explicit selection.
- [Modal filesystem](https://modal.com/docs/guide/sandbox-files), [networking](https://modal.com/docs/guide/sandbox-networking) and [VM Sandboxes](https://modal.com/docs/guide/vm-sandboxes): generic service connection and deployment-specific filesystem capabilities.

No universal dependency-discovery API was found. Track upstream licensing when
porting source-derived behavior.

## Plan validation

`poe-code pipeline validate docs/plans/remote-media-cli.md`

29 tasks, each with scalar `status: open`. Schema validation only.
