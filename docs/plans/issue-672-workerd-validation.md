# Issue 672: installed-artifact workerd acceptance

## Status — installed-artifact acceptance passed

On September 8, 2026, **29/29 cases passed in actual workerd with compatibility
flags empty** for the freshly built and offline-installed candidate from
`6355de7e74737f4c382e891140a936bc847240f1`, version `0.0.0-issue672-delivery3`.
This is installed-artifact evidence, not merely a source bundle or VM test.
Any subsequent artifact change requires fresh admission and execution.

This v7 admission uses the fresh installed consumer explicitly released by root
after the maintained normal build restored the bundling suffix following unit
tests. Root identified v5 as invalid because it was packed from raw tsc output;
it is not accepted here. Earlier results at
`c84a65569126063264eb437b169cdfdd2e7ced95`,
`891ea4bda33493d296754fc5ac5dec9a8ea4ead3`, and
`343ddf932d83d9e4338032e83aa99a358744b21b` remain preserved intermediate evidence,
not substitutes for this run. The v7 post-run receipt was recorded at
20:41:47 UTC. Root authorized this document update after lint completed with
exit zero.

This sidecar owns only this document and uniquely owned temporary QA artifacts.
Product, maintained tests, public fixtures, manifests, build scripts, and Git
remain untouched. Repository writes freeze again after this document is prepared.

## Prepared tools and provenance

- Temporary probes: `/tmp/kamilio-672-workerd-qa.MrAWhd/`.
  `worker.mjs` contains the public-API acceptance cases; `prepare.mjs` admits and
  bundles a released installed consumer; `runtime.mjs` runs and checks the actual
  Miniflare/workerd response and cleanup. These are disposable execution aids,
  not a new repository QA route.
- Prior setup, inspected read-only:
  `/tmp/kamilio-669-671-workerd.LqXCfv/`.
- Reused runtime tooling: `/tmp/kamilio-649-workerd.PFPrK5/`.
  Its old safe-package dependencies are not candidate inputs. Only its runtime
  tooling is used; the candidate worker is self-contained.
- Host preparation uses Node 22 from `/tmp/kamilio-toolchain.path` and records the
  actual Node and installed esbuild versions. No dependency installation is part
  of this pass.

The prior setup identifies these pins; verify them again for the actual run:

| Component | Required identity |
| --- | --- |
| Docker image ID | `sha256:6e6261159fd399ebe5a3d556b7d89da9c85c873f3f270918aad6c8107da8b411` |
| Image repository digest | `node@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5` |
| Container Node | `v22.23.2` |
| Miniflare | `4.20260708.1` |
| workerd package | `1.20260708.1` |
| workerd executable version | `workerd 2026-07-08` |
| workerd executable SHA-256 | `a74a07d8003e5ea018d4fe4c4746c70e38b73aa5d5add97747a959991bd3e000` |
| Compatibility date | `2026-07-01` |
| Compatibility flags | `[]` — no Node compatibility flag |

Record actual image metadata, architecture, glibc, runtime package versions and
hashes, executable hash, preparation-helper hashes, and worker bundle hash.
Do not pull a moving image tag or silently substitute different tooling.

## Admission and browser graph

Only after root explicitly releases a fresh consumer and full commit:

1. Bind the consumer to root's supplied commit. The prepared admission expects a
   matching `../head` file beside the consumer. If root supplies another layout,
   adapt only the temporary admission probe to the actual provenance; never
   manufacture a matching revision file or assume the current checkout built it.
2. Record versions, manifests, conditional exports, and SHA-256 hashes of the
   installed `safe-bash`, `safe-fs`, and `safe-js` packages and their supplied
   tarballs. The prepared layout expects each tarball inside the consumer as
   `poe-platform-<package>-<version>.tgz`. Record the installed lockfile when present.
   Reject package directories resolving outside this consumer's `node_modules`.
3. Bundle temporary worker imports of default `@poe-platform/safe-bash` and
   `@poe-platform/safe-fs/core`, resolving from the installed consumer. Use esbuild
   `platform: "browser"`, ESM, and conditions `workerd`, `worker`, `browser`.
   No source aliases, replacement modules, externalized imports, or plugins.
4. Require the manifest-selected default browser entry to appear in the actual
   input graph. Root currently describes it as `dist/core.browser.js`; verify the
   admitted manifest rather than assuming a filename proves resolution.
5. Require every dependency input to be an installed consumer file, zero external
   or `node:` input edges, zero emitted imports, and zero bundle warnings. Retain
   the full metafile and hashes of every input. A source file's existence alone
   neither proves nor disproves the public installed graph.
6. Save admission, provenance, bundle, and metafile in a new `candidate-*`
   directory. Preserve any failed preparation evidence. Preparation success is
   explicitly `prepared-not-runtime-validated`, not runtime acceptance.

Admission procedure, executed for the final candidate:

```sh
export PATH="$(cat /tmp/kamilio-toolchain.path)/bin:$PATH"
QA=/tmp/kamilio-672-workerd-qa.MrAWhd
: "${CONSUMER:?Root must release the fresh installed consumer}"
: "${EXPECTED_HEAD:?Root must identify the fresh artifact full commit}"
ROOT_ARTIFACT_READY="$EXPECTED_HEAD" node "$QA/prepare.mjs" "$CONSUMER" "$EXPECTED_HEAD"
```

Use the newly printed candidate directory for the next step, not a previously
discovered candidate. Both root authorization and provenance checks are required;
setting an environment variable alone is not authorization.

## Acceptance cases — 29 passed

All commands execute inside actual workerd with `compatibilityFlags: []`. The
worker imports only public installed entry points. Filesystem fixtures live in
memory; there are no slow disk-unit fixtures or outbound service calls.

| # | Case | Required observation |
| --- | --- | --- |
| 1 | `globals-no-node` | `process`, `Buffer`, `require`, and `Worker` absent; Web Crypto entropy and UUID functions available. |
| 2 | `canonical-filesystem-identity` | Default entry's `FsError`, `MemoryFileSystem`, and browser `posixPath` identical to canonical safe-fs/core exports. No full Node path API assertion on this browser entry. |
| 3 | `inventory-factory` | Actual `createAgentCommands()` names equal the independent complete 79-name inventory, not merely its count. |
| 4 | `inventory-plugin` | Actual plugin registration produces the same 79 names; dispose the plugin. |
| 5 | `sha256` | `printf abc` pipeline matches the fixed SHA-256 vector and expected stdout/exit/stderr. |
| 6 | `md5` | Same pipeline matches the fixed MD5 vector. |
| 7 | `cksum` | POSIX CRC output for `abc` is `1219131554 3`. |
| 8 | `checksum-manifest` | Generate and check a manifest; exact `/hash: OK` output. |
| 9 | `checksum-cap` | Two-byte configured input budget rejects three bytes with exit 1 and `EFBIG`, without digest output. |
| 10 | `gzip-binary-roundtrip` | `gzip -c` and `zcat` preserve every byte of a 65,553-byte non-text fixture. |
| 11 | `gzip-malformed` | Invalid gzip returns exit 1, empty stdout, and a non-internal-error diagnostic. |
| 12 | `gzip-output-cap` | Decompression under a 1,024-byte shell output cap throws the branded `ShellLimitError` for `maxOutputBytes`. |
| 13 | `tar-gzip-file` | Create `.tar.gz`, extract to a directory, and read the exact payload. |
| 14 | `tar-gzip-pipeline` | Create gzip tar on stdout and extract from stdin, then read the payload. Do not use unsupported `tar -O`. |
| 15 | `mktemp-private-file` | Inspect the captured filesystem's `stat`: file with mode `0600`. Shell has no public `fs` property. |
| 16 | `mktemp-private-directory` | Captured filesystem's `stat`: directory with mode `0700`. |
| 17 | `mktemp-exclusive-collision` | Inject one real in-memory collision, observe `wx`/`0600`, retry within two attempts, and preserve the colliding file bytes. |
| 18 | `timeout-active` | A registered cooperative command actually starts; 10 ms timeout returns 124 and releases its listener/active operation and registered cleanup. |
| 19 | `timeout-outer-cancel` | Cancel an already-started child under a five-second timeout; preserve the caller's exact abort reason and release the same resources. |
| 20 | `expr-length` | Default bounded backend returns length 3 for `abc : a.*`. |
| 21 | `expr-capture` | Supported BRE capture returns `b`. |
| 22 | `expr-nonmatch` | Anchored nonmatch returns `0` and exit 1. |
| 23 | `expr-unsupported-escape` | Unsupported BRE escape refuses with exit 2 and the expected diagnostic, not native fallback. |
| 24 | `expr-non-ascii` | Unsupported non-ASCII matching refuses with exit 2 and an ASCII diagnostic. |
| 25 | `env-jq` | Nested command executes `jq -nc '1+1'`, yielding `2` and exit 0. |
| 26 | `xargs-jq` | Quoted expression carried by xargs yields the same result. |
| 27 | `env-env-jq` | Two env layers preserve owned argument/runtime contracts. |
| 28 | `xargs-env-jq` | xargs plus env nesting preserves the same contracts. |
| 29 | `borrowed-provider-lifecycle` | Two shells borrow one explicit bounded provider; disposing one leaves the other usable. Shell disposal never disposes the caller's provider or separately owned endpoint. Explicit final owner cleanup retires all created endpoints. |

The runner independently checks the exact case names and requires 29 successful
results, HTTP 200, zero internal-error diagnostics, no live shells, and zero
outbound requests. A missing case, unsupported runtime, timeout, partial run, or
skipped case is not a pass. This covers the complete inventory plus selected
behavioral families, not every operation of all 79 commands.

## Actual execution and resource boundaries

After admission, obtain permission for the Docker execution if required. Use the
pinned local image, no outbound network, no published ports, read-only mounts,
non-root UID/GID, dropped capabilities, and no privilege escalation. Mount only
the prepared QA helpers, candidate, and pinned tooling; do not expose the checkout,
credentials, Docker socket, or installed consumer to the worker container.

Each shell execution has a two-second abort watchdog; shell command and output
budgets are 4,096 and 2 MiB. The response is capped at 512 KiB. The Node driver has
a 60-second watchdog; Docker has a 75-second outer deadline plus five seconds of
termination grace. Container limits are two CPUs, 1 GiB memory, 128 processes, and
128 MiB temporary storage. The custom outbound service rejects any attempted
network use and must report zero attempts.

Runtime procedure, executed for the final candidate:

```sh
: "${CANDIDATE:?Use the newly admitted candidate directory}"
TOOLS=/tmp/kamilio-649-workerd.PFPrK5
IMAGE=sha256:6e6261159fd399ebe5a3d556b7d89da9c85c873f3f270918aad6c8107da8b411
RUN=$(mktemp -d "$CANDIDATE/run-XXXXXX")
NAME="issue-672-$(basename "$CANDIDATE")-$(basename "$RUN")"
docker image inspect "$IMAGE" > "$RUN/image.json"
status=0
timeout --foreground --signal=TERM --kill-after=5s 75s \
  docker run --rm --init --name "$NAME" --cidfile "$RUN/container.cid" \
  --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
  --user "$(id -u):$(id -g)" --cpus 2 --memory 1g --pids-limit 128 \
  --tmpfs /tmp:rw,nosuid,nodev,size=128m,mode=1777 \
  -v "$TOOLS:/mf:ro" -v "$QA:/qa:ro" -v "$CANDIDATE:/candidate:ro" \
  "$IMAGE" node /qa/runtime.mjs \
  > "$RUN/runtime.stdout.jsonl" 2> "$RUN/runtime.stderr.log" || status=$?
printf '%s\n' "$status" > "$RUN/exit-code"
```

Retain raw output even on failure. Inspect the structured `versions`, `ready`,
`result`, `disposed`, and `complete` events, not just the process exit code. Confirm
the runtime reports the admitted commit and exact worker bundle hash. The driver
disposes Miniflare in `finally` and records container-local process snapshots;
require zero remaining workerd processes after disposal.

Regardless of exit status, query Docker for this exact generated container name.
If a deadline left that owned container behind, capture its inspect/log evidence
and remove only that container. Record a successful Docker query showing it is
absent afterwards; daemon failure is not cleanup evidence. Do not kill unrelated
workerd processes, prune containers, or delete earlier investigation artifacts.

Before accepting the run, recompute and compare every recorded tarball, installed
manifest/input, lockfile, helper, runtime-tool, and bundle hash against admission.
Retain a post-run hash-verification receipt. Any drift invalidates the candidate
and requires a new directory and fresh run. Preserve all failed attempts and
explain any temporary probe correction separately from product failures.

## Evidence and handoff

- Consumer: `/tmp/kamilio-672-delivery-v7-public.8OvgFK/consumer`; its `../head`
  matches root's explicitly supplied full commit above. The normal-build receipt
  `/tmp/kamilio-672-delivery-v7-build.exit` and maintained-unit receipt
  `/tmp/kamilio-delivery-v6.K4UWR1/unit.exit` both contain zero. Root reports the
  normal build followed the unit run and all three fresh tarballs were installed
  offline with lifecycle scripts disabled. This sidecar did not rerun those gates.
- Receipt directory:
  `/tmp/kamilio-672-workerd-qa.MrAWhd/candidate-HsOPmO/run-UgYiEC/`;
  `final-report.json`, `runtime.stdout.jsonl`, and `post-run-hashes.json` retain
  execution, provenance, and cleanup details. Admission and the complete
  metafile are retained in the parent candidate directory. The v7 verifier is
  `/tmp/kamilio-672-workerd-qa.MrAWhd/verify-v7.mjs`; previous verifier files and
  candidate directories remain unchanged.
- Graph: 34 installed inputs, no Node or external edges, no emitted imports.
  All three tarball SHA-512 digests match the installed lockfile. All 49 recorded
  files remain unchanged after execution.
- Actual selected entry:
  `/tmp/kamilio-672-delivery-v7-public.8OvgFK/consumer/node_modules/@poe-platform/safe-bash/dist/safe-bash/core.browser.js`;
  SHA-256 `a4d216e79bd8eb7fcf68ff19f304d5abe03b4126072f5e526b4e3221aaead9e7`.
- Worker bundle: 2,044,533 bytes; SHA-256
  `b4ca99af833b26d65165744d55bb186463f2edbcabec71fdc7b5d12a4768c062`.
  Although these bundle bytes match v3, v7 was admitted and bundled from its own
  installed files and executed in a fresh container; no earlier runtime result
  was reused.
- Actual workerd: pinned versions listed above, flags `[]`, network disabled,
  HTTP 200, 29/29 passing cases, exit zero, no internal diagnostics or outbound
  attempts. Miniflare is disposed; zero remaining workerd processes and no owned
  container remain, verified by a successful Docker query.
- Root separately reports passing installed Node/Bun smoke, Node declarations,
  strict browser declarations without ambient Node types, and the browser smoke
  fixture. `/tmp/kamilio-672-delivery-v7-public.8OvgFK/public-smoke.exit` contains
  zero. This sidecar did not duplicate those runs or verify a CI/release result.
- Visual evidence is explicitly a separate local playground check:
  `/tmp/kamilio-672-playground-retest.8ZgRmu/commands.png` was captured and inspected.
  Startup, anchored regex search, SHA-256, and gzip/zcat output pass. Its owned
  browser session is closed. This screenshot does not claim to depict workerd;
  the raw workerd execution receipt supplies that evidence.

The admitted v7 tarballs have these SHA-256 bindings; their full SHA-512 integrity
strings and installed lockfile matches are also retained in `final-report.json`:

| Package, version `0.0.0-issue672-delivery3` | Bytes | SHA-256 |
| --- | ---: | --- |
| `@poe-platform/safe-bash` | 2,230,049 | `f00c8ac4f3381597943adbb6c829bbb5c2a61c70d867c22c7f989848dcbe5741` |
| `@poe-platform/safe-fs` | 107,565 | `5acce8de77d1441d074dea71c988f718051dbb34ff44c26230060b215e3ba394` |
| `@poe-platform/safe-js` | 4,189,646 | `9621e3ac632e3f17c4846f84f84632a0c622cc64f85fbf7bdb9c90ebbc0c463f` |

Report preparation failures, actual runtime failures, successful acceptance, and
remote delivery/release separately. Root retains Node/Bun/type smoke ownership
unless explicitly delegated; do not duplicate those runs. This sidecar neither
closes issue 672 nor claims the entire earlier issue 669 request complete.
