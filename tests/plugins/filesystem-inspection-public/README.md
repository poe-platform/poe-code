# Tree/file public integration: author handoff

## Frozen result, 2026-08-27

Root-authorized wiring `1ad428ed` exposes the independently reviewed tree/file
implementations through root/subpaths and the default aggregate. This is new
integration authorship, **not its independent acceptance**. A different reviewer
must check this wiring and public consumer before root accepts it.

Final candidate: `79316dfe792d9342eda2cedff503f98f431778c4`, captured
2026-08-27T10:36:34.896Z–10:36:44.076Z, Node22.22.2 / TypeScript5.9.3 /
Darwin arm64. No dependency installation, product implementation change,
external service, private-source access or whole-product gate in this replay.

| Executed check | Result |
| --- | --- |
| Clean temporary production build and production no-emit types | pass |
| Selected source tests: maintained registry/workflows plus tree/file | 199/199, zero skips/TODOs |
| Strict moved-package positive consumer types | pass |
| New packed public tests, plain Node, two executions | 13/13 each, zero skips/TODOs |
| Existing maintained stream options and inspection consumers | both compile and execute |
| Six invalid public type uses | four TS2353 and two TS2322, as expected |
| Missing tree/file runtime: root and subpath imports | four ERR_MODULE_NOT_FOUND refusals |
| Attempted access to withdrawn repository source | ERR_ACCESS_DENIED |
| Packed dist bytes equal clean build; source bytes unchanged | both true |
| Temporary build/consumer/package resources | removed in finally |

The source-test file list, complete TAP/diagnostics, commands, versions, tools,
source files and hashes are in `evidence/final-report.json`. The runner requires
actual199/13 execution and zero skips/TODOs, not merely successful process exit.
The source tests are **not all repository tests**. No global test typecheck or
service/native-oracle suite is inferred from the production/public type checks.

Source-tree SHA256:
`f8b951b9f6802ea6a178ac22dd10b157ec511f7b77ad2a0a038de34a1c51d294`.
706-file packed artifact SHA256:
`c61274d0fcf14fe4a8dfd3a7b8e1039d51ea914d4eb39617d7a191a5a60202b9`.
`MANIFEST.json` authenticates this harness and both captured reports.

First replay `9bd8bd07` also passed the same199 and twice13; its package hash
`6f985dda616e7711d3b09438b4c67f9df8e212dba1e825f97af04e90a185e7e3`
is distinct. Final candidate adds explicit execution-count guards and corrects
one current README count68→70; product source-tree hash is identical. Neither
report is overwritten. Historical count-failure capture and the separately
committed current fixture migration are in `migration/README.md`.

## Stable APIs and policies

Root `virtual-bash` and subpath `virtual-bash/commands/tree` export
`treeCommands(options?)`, `createTreeCommands(options?)`, `createTreeCommand(options?)`,
`TreeCommandsOptions`, `TreeLimits`. The analogous file names are
`fileCommands`, `createFileCommands`, `createFileCommand`, `FileCommandsOptions`,
`FileLimits`, available from root and `virtual-bash/commands/file`.

Each family accepts optional `replace` and `limits: Partial<...>`. Aggregate
`AgentCommandsOptions.tree` and `.file` omit `replace`; top-level aggregate
replacement remains authoritative, including untyped attempted overrides.
Both command arrays and actual installed Shell registry are checked against an
explicit independently written70-name set, not names derived from the factory.
Curl and SafeJS remain absent unless explicitly registered. No runtime deps.

The new packed consumer exercises factory/plugin dispatch, standalone families,
atomic collision preflight, preservation of unrelated commands, limit forwarding,
VFS pipes/redirections, byte-derived MIME rather than extensions, literal
Unicode/newline names, symlink entry versus target, bounded sniff/iterator close,
caller cancellation identity/late rejection, and unchanged host environment.
It checks supported unknown-capability refusal before content access and
unchanged bytes. Its NaN-size nonstreaming case is explicitly a malformed/
unknown provider-boundary control: FileStat.size is required, not optional.

Tree output may already contain a prefix, or incomplete JSON, when a later
limit/backend error occurs; this is not rollback or snapshot traversal. File
sniffing is bounded and is not full libmagic, decompression or whole-document
JSON validation from an incomplete prefix. Missing capabilities are refused,
not fabricated; limits and partial-output profiles remain unchanged. No full
native parity, arbitrary-provider, security-isolation or superiority claim.

## Source authority and isolation

Every `src/commands/tree/**` byte equals approved
`436bda3e21b2b6041409fac7408cf072b5d3fe5e`; every file-family byte equals
`cd37ce07c1f41f3797e19e0f701b662823338843`. The runner checks those exact Git
diffs before build. The underlying independent handoff is
`tests/commands/filesystem-inspection-stress/harness-review/INTEGRATION_HANDOFF.md`.
Its four original valid safety rows plus two derived corrections do **not**
become six original passing rows through this integration.

The candidate includes sealed byte fixes7a517cec/7d7dce7c and canonical rmdir
profile migration3bf672f7; their full selected independent holdouts are **not
rerun here**. Their source acceptance/81-position profile and older stock78/79,
configured79/79 cohorts remain separate. No later moving worktree is certified.

The runner archives only committed selected inputs and builds under a fresh
temporary directory. Development tools are reused for compilation only. The
package is unpacked as regular files, the consumer is moved, original source
is withdrawn, strict type inputs are constrained to the moved consumer and
compiler standard library. Runtime FS reads are restricted to that consumer;
no process permission is granted. This is tested no-source-fallback isolation,
**not a general network/host-JavaScript sandbox**. No server is started.

## Reproduction and next review

```sh
node tests/plugins/filesystem-inspection-public/verify.mjs \
  79316dfe792d9342eda2cedff503f98f431778c4 \
  /tmp/safe-bash-inspection-public-new-output
```

Use a nonexistent output directory and harness bytes matching the manifest;
the runner refuses uncommitted harness drift and removes only its own scratch.
Evidence JSON remains at the requested output path. Templates are maintained
`.ts.fixture` files compiled as external `.mts`; they do not add unclassified
tracked `.mts` paths or change historical sealed consumers.

Root should assign a different integration reviewer, then choose an exact
whole-gate candidate/cohort including the sealed byte/rmdir inputs. Inventory
review862fdc54 accepted the original20 classifications but found a self-contained
WebDAV consumer not executed and a mandatory runtime-omission guard hole. Those
findings remain open; no release-config fix or whole-gate acceptance is claimed.
