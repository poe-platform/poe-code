# Independent tree verifier: PREP embargo

Author must not read this directory or obtain its corpus before root's failure
handoff. Mode 0700 limits other accounts, not same-user agents; separation is a
coordination rule, not a sandbox guarantee. Only root/verifier may resume.

## Frozen inputs

`corpus.mjs` defines 38 intended cases. `native.json` retains the original 20
native captures, including nonzero statuses, literal bytes and source-independent
oracle defects. `provenance.json` is the original capture-time record; later
preseal clarifications are in `preseal.json`, not silently backdated into it.
`selftest.mjs` tests only this verifier and captured fixtures, never the product.

The pinned tool is a copy of the already present native tree 2.2.1 binary; this
verifier neither fetched nor built another tool. The manual at upstream tag
2.2.1 was checked through web. Its local file, archive, source-file hashes and
binary hash are recorded. Exact compiler/build provenance still requires root's
record. Darwin C-locale captures are not a GNU/Linux or latest-tree claim.

N14 exposes a native defect/limitation: a second sibling alias is printed as
recursive. Original bytes remain unchanged. The user's ancestor-cycle rule
instead requires each sibling alias to traverse. Its acceptance is explicitly a
project invariant, NOT byte parity with the native oracle. N17/N18 retain native
diagnostics/statuses but test meaningful failure, not an invented universal
numeric errno/exit convention. N15 remains exact only under the declared native
profile; different cycle diagnostics are not automatically the same profile.

## Root resume protocol

1. Obtain author-finished evidence and freeze the candidate source/package hashes
   before looking at any execution failure. Record dirty versus frozen state.
2. Verify the repository hash manifest against this directory and native fixture
   inventory. Do not edit sealed expectations or fixture inputs.
3. Inspect the now-finished public API. Write a NEW unsealed adapter and profile
   in a separate verifier-owned `/tmp` resume directory. Final API is pending;
   no proposed plugin name in this preparation is an approved integration.
4. Adapter exports, using real inspected APIs, are:
   - `makeFsError(code, options)`: constructs the actual contract FsError.
   - `createCommand({ entries?, outputBytes? })`: returns the actual tree command
     definition; map only documented limits, with no argv/output/error rewriting.
   - `createRealFileSystem(root)`: the actual adapter rooted at the given path.
   - `createMemoryFileSystem()`: an actual empty writable memory adapter.
   - `executeShell({ fs, commands, script, env, signal })`: actual Shell/registry
     execution with these command definitions exactly once, exported environment,
     and byte stdout/stderr result. Never a shell stub or homemade pipeline.
5. A JSON profile records `candidateSourceHash`, `authorFinishedEvidence`,
   `supportedProfileEvidence`, and `supportedFeatures`. Decide it from published
   author-supported behavior BEFORE running cases, not by observing failures.
6. Run each selected case in its own Node process with an external bounded test
   watchdog; the verifier's own FS/output guards are not product limits. Example:

   ```sh
   TREE_HOLDOUT_ROOT_RESUMED=AUTHOR_FINISHED node --import tsx run.mjs --execute /tmp/owned-resume/bridge.mjs /tmp/owned-resume/profile.json N01
   ```

   Run from this directory; root may need the repository's absolute installed tsx
   loader path because this directory is outside the package dependency tree.
   Use the same execution command without the final ID only with a whole-process
   watchdog and after checking per-case cleanup. Importing or executing the
   adapter is forbidden during PREP. The default runner performs no imports.
7. Preserve per-case original output, exception, source identity, argv/profile,
   counts and unsupported cases. Route concrete failures to root, which reveals
   only the relevant reproducer to the author. Never adjust expectations because
   candidate output differs. True oracle/harness corrections retain originals
   and need an explicit reason independent of candidate success.

## Supported profile, not feature inflation

`ascii-C-profile` means the command accepts `-n --charset=ASCII` and declares
native-compatible C ordering, ASCII connectors and reports. Remaining feature
keys in the corpus name their exact flags: hidden `-a`, depth `-L`, reverse `-r`,
dirsfirst `--dirsfirst`, directories-only `-d`, include/exclude glob `-P`/`-I`,
prune `--prune`, flat `-i`, full-path `-f`, no-report `--noreport`, literal-names
`-N`, and native-filelimit `--filelimit`. `native-C-escaping` is explicitly the
pinned C-locale byte escaping policy, not arbitrary Unicode-safe output.
`native-json-schema` means `-J` with the native array/contents/name schema;
unrelated valid JSON formats do not implicitly promise that schema. Symlinks and
follow-links mean the matching native rendering/follow flags for exact cases.

Missing optional capabilities are `unsupported-not-pass`. Required invariants
cannot be feature-skipped. A36 always exercises a real configured adapter and
poison stdin. A37 always uses actual Shell pipelines, parentheses, redirection
and a registry stdin consumer. It selects JSON only when native JSON/no-report
are declared; otherwise its presealed text-consumer branch still runs, while
JSON coverage is explicitly unsupported, not a JSON pass. No jq dependency is
needed; a legitimate registered command receives actual piped bytes.

Global entry/output budgets use adapter mappings to documented options; native
`--filelimit` is never used to fake a global traversal budget. Output checks use
UTF-8 bytes. The stdout bound is a minimum invariant even if a provider counts
stderr too. Entry checks do not prescribe whether the root is included.

## Provider and cancellation boundaries

Conforming identity probes use truthful disjoint opaque scope references, or
unknown/unscoped/partial tuples, never false scope claims on shared storage.
`realpath` exists but rejects ENOTSUP in the required unknown-identity probes.
The missing-method variant is explicitly nonconforming: `realpath` is required
by FileSystem. Readdir names have no stronger documented validation/uniqueness
rule than DirectoryEntry's name/type shape. Malicious and duplicate listings
are exploratory; report escapes and boundedness, do not demand a particular
deduplication/rejection policy or disguise characterization as a pass.

Errors use the product's FsError only after resume. Diagnostics are ordinary
human-readable text, not errno serialization. Partial output may be empty for
buffered formats; any accepted prefix or sink partial effect is irreversible.
No required transactional rollback or completed-effect cancellation is invented.
Pending FS/sink probes intentionally leave host work uncooperative until after
abort; report bounded local settlement and observed late rejections. Direct
handlers must fail rather than return success; rejection, if used, preserves
the reason. Nonzero handler cancellation does not by itself establish the exact
public Shell reason-identity contract. This remains a disclosed coverage limit.

The metadata-only VFS tripwires and real root do not prove absence of arbitrary
host imports or subprocesses in future product code. Static product audit,
zero-runtime-dependency evidence, deployed providers, public exports and packed
consumer validation belong to post-candidate integration, not this PREP claim.
