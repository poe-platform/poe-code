# Issue 551: public portable-search workerd acceptance

This is a manually executed acceptance plan, not an automation or release gate.
Root owns normal builds, public packaging, shared test registration, and delivery.
Do not start a competing build or claim a registry release from local artifacts.

## Prerequisites and binding

1. Read `packages/safe-bash/docs/PORTABLE_SEARCH.md`, especially the trusted
   provider boundary and the deliberately restricted acceptance adapter.
2. Run the normal root `npm run build` after the final source changes. Use normal
   packaging (`scripts/package-safe.mjs`, coordinated by root), then `npm pack`
   the resulting safe-bash, safe-fs, and safe-js directories. Install those local
   tarballs into a clean temporary consumer. Do not alias repository source or
   deep-import an implementation as a substitute for the public entry.
3. Record the exact tarball SHA-256 hashes and installed versions. Resolve
   `@poe-platform/safe-bash/browser` from that consumer, record its path and SHA-256,
   and confirm it exports `portableSearchCommands`, `EreLedger`, `compileEre`, and
   `matchEre`. Record canonical `@poe-platform/safe-fs/core` as well.
4. Install workerd only as external test tooling, not a runtime dependency:
   `npm install --prefix /tmp/safe-bash-551-tools --no-save --package-lock=false workerd@1.20260904.1`.
   Record `/tmp/safe-bash-551-tools/node_modules/.bin/workerd --version` and the
   executable's resolved path. Preserve this version in the acceptance evidence.

## Build the integration fixture

5. Create a fresh `/tmp` acceptance directory. Copy `provider.mjs`, `worker.mjs`,
   and `config.capnp` from
   `packages/safe-bash/tests/integration/portable-search-workerd/` into it.
6. Use the installed esbuild API to bundle `worker.mjs` to `bundle.mjs` in that
   directory with `bundle: true`, `platform: "browser"`, `format: "esm"`,
   `target: "es2022"`, `conditions: ["workerd", "worker", "browser"]`, and
   `nodePaths: ["<consumer>/node_modules"]`. Retain its metafile. No shims,
   externals, source aliases, or test-only Node compatibility flags are allowed.
7. Inspect the metafile: actual input files must include the installed
   `@poe-platform/safe-bash` and canonical `@poe-platform/safe-fs` artifacts;
   no repository `src` files, Node workers, Node event modules, or unresolved
   imports are allowed. The provider's ERE primitives come from the same public
   browser entry as the commands, not a private implementation import.
8. A browser bundle succeeding is prerequisite evidence only, not a workerd pass.

## Execute and inspect

9. Run `timeout 20s <recorded-workerd-executable> test <acceptance>/config.capnp`.
   Keep both raw stdout/stderr and the actual exit status (use pipefail if teeing).
   A timeout, crash, missing marker, or incomplete case list is failure.
10. Require `PORTABLE_SEARCH_WORKERD_PASS` with all listed cases, and workerd's
    successful test result. Inspect actual command output bytes/status, not just
    imports or successful initialization. The Worker must lack global Buffer,
    process, and browser Worker constructors; canonical filesystem error identity
    must hold without Node compatibility flags.
11. Verify real stdin/VFS grep and rg matching, sed, and a three-command pipeline.
    The provider uses the real public budgeted ERE interpreter, not host native
    RegExp, canned matching results, or a duplicated command implementation.
12. Inspect failures for `^(a+)+$`: explicit work-limit failure and active-request
    timeout for both grep and rg, then successful reuse with a benign pattern.
13. Require evidence that cancellation and disposal interrupted active matching,
    after at least 256 charged work units, with no pending jobs, listeners, or
    unterminated endpoints after public settlement. No opaque host process is
    involved in matching; workerd is only the test runtime.
14. Verify rg output limits, sed step limits, and provider pattern admission.
    Run the focused Node suites separately for queue admission, preabort, startup
    timeout, slow retirement, protocol rejection, Node matcher semantics, and
    browser numeric timer handles.

## Honest result boundary

Record changed source/test paths, exact commands and counts, artifact identities,
workerd version, raw log locations, and any failures beside successful reruns.
The acceptance provider supports one case-sensitive ASCII pattern, selection
only, and a restricted BRE subset; it rejects all-match enumeration, Unicode,
case/word flags, and globs. This qualifies the injected public seam and real
bounded execution in workerd, not a complete production Unicode/glob adapter,
Cloudflare deployment, registry release, or the entire repository test suite.

## Exact local candidate commands

Run from the repository root after root announces the candidate artifact directory
is ready. Set `ARTIFACT_ROOT` to that exact directory. Do not overwrite or reuse the earlier
`/tmp/kamilio-safe-packages` cut snapshot. Retain old red-boundary evidence beside
the new candidate's results, and use fresh consumer/acceptance directories so a
previous version cannot satisfy module resolution.

```sh
: "${ARTIFACT_ROOT:?Set ARTIFACT_ROOT to the directory announced ready by root}"
export CONSUMER=$(mktemp -d /tmp/safe-bash-551-local.XXXXXX)
npm pack --pack-destination "$CONSUMER" \
  "$ARTIFACT_ROOT/safe-bash" \
  "$ARTIFACT_ROOT/safe-fs" \
  "$ARTIFACT_ROOT/safe-js"
npm install --prefix "$CONSUMER" --package-lock=false --no-audit --no-fund "$CONSUMER"/*.tgz
sha256sum "$CONSUMER"/*.tgz
```

## Exact released-package rerun

Root must repeat this acceptance after successful publication, using an actual
verified release version. Do not close #551 based only on the local candidate.
Set `VERSION` to the version established by root's release evidence, then:

```sh
: "${VERSION:?Set VERSION to the verified published version}"
export CONSUMER=$(mktemp -d /tmp/safe-bash-551-npm.XXXXXX)
npm view "@poe-platform/safe-bash@$VERSION" version dist --json \
  > "$CONSUMER/registry-binding.json"
npm pack --pack-destination "$CONSUMER" \
  "@poe-platform/safe-bash@$VERSION" \
  "@poe-platform/safe-fs@$VERSION" \
  "@poe-platform/safe-js@$VERSION"
npm install --prefix "$CONSUMER" --package-lock=false --no-audit --no-fund "$CONSUMER"/*.tgz
sha256sum "$CONSUMER"/*.tgz
```

## Shared bundle and execution commands

These commands apply to either fresh consumer above. Keep `CONSUMER` exported.

```sh
export ACCEPTANCE=$(mktemp -d /tmp/safe-bash-551-workerd.XXXXXX)
cp packages/safe-bash/tests/integration/portable-search-workerd/{worker.mjs,provider.mjs,config.capnp} "$ACCEPTANCE/"
NODE_PATH="$CONSUMER/node_modules" node_modules/.bin/esbuild "$ACCEPTANCE/worker.mjs" \
  --bundle --platform=browser --format=esm --target=es2022 \
  --conditions=workerd,worker,browser --metafile="$ACCEPTANCE/meta.json" \
  --outfile="$ACCEPTANCE/bundle.mjs"
(cd "$CONSUMER" && node --input-type=module -e '
  import { readFile } from "node:fs/promises";
  import { createHash } from "node:crypto";
  for (const entry of ["@poe-platform/safe-bash/browser", "@poe-platform/safe-fs/core"]) {
    const resolved = import.meta.resolve(entry);
    const hash = createHash("sha256").update(await readFile(new URL(resolved))).digest("hex");
    console.log(JSON.stringify({ entry, resolved, sha256: hash }));
  }
') | tee "$ACCEPTANCE/public-binding.jsonl"
node --input-type=module -e '
  import assert from "node:assert/strict";
  import { readFile } from "node:fs/promises";
  const meta = JSON.parse(await readFile(process.env.ACCEPTANCE + "/meta.json", "utf8"));
  const inputs = Object.keys(meta.inputs);
  assert(inputs.some(path => path.includes("node_modules/@poe-platform/safe-bash/")));
  assert(inputs.some(path => path.includes("node_modules/@poe-platform/safe-fs/")));
  assert(!inputs.some(path => path.includes("/src/") || path.includes("node:worker_threads")));
  assert(Object.values(meta.outputs).every(output => output.imports.length === 0));
  console.log(inputs.join("\n"));
' | tee "$ACCEPTANCE/public-inputs.txt"
sha256sum "$ACCEPTANCE"/{bundle.mjs,meta.json,config.capnp,provider.mjs,worker.mjs}
```

On a host with sufficiently recent GLIBC, use the recorded binary directly:

```sh
set -o pipefail
/tmp/safe-bash-551-tools/node_modules/.bin/workerd --version
timeout 20s /tmp/safe-bash-551-tools/node_modules/.bin/workerd \
  test "$ACCEPTANCE/config.capnp" 2>&1 | tee "$ACCEPTANCE/workerd.log"
```

The implementation host has GLIBC 2.31; workerd 1.20260904.1 requires GLIBC 2.35.
Its npm executable resolves to
`/tmp/safe-bash-551-tools/node_modules/workerd/bin/workerd` and reports
`workerd 2026-09-04` in the existing Bookworm image. A read-only, non-root,
no-network container avoids modifying the host's libraries:

```sh
set -o pipefail
IMAGE=sha256:6e6261159fd399ebe5a3d556b7d89da9c85c873f3f270918aad6c8107da8b411
docker image inspect --format '{{.Id}}' "$IMAGE"
timeout 20s docker run --rm --name safe-bash-551-workerd-test \
  --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
  --user "$(id -u):$(id -g)" \
  --mount type=bind,src=/tmp/safe-bash-551-tools,dst=/tools,readonly \
  --mount type=bind,src="$ACCEPTANCE",dst=/acceptance,readonly \
  "$IMAGE" /tools/node_modules/.bin/workerd test /acceptance/config.capnp \
  2>&1 | tee "$ACCEPTANCE/workerd.log"
```

Require actual zero exit plus the assertion marker and complete case count.
Run as the current non-root user so the container can read its mode-700 temporary
directory; do not assume that the host user's UID/GID is 1000.
If the external timeout fires, remove only the container created for this run
with `docker rm -f safe-bash-551-workerd-test`, retain the timeout evidence, and
do not report a pass. A newer machine may run the same recorded workerd binary
directly, without Docker. Record any runtime/image change rather than implying
that it is the same environment.

## Recorded local candidate result: September 4, 2026

**PASS: 15 workerd cases, exit 0. Not a published-release qualification.**
Root's normal build supplied `/tmp/kamilio-safe-packages-v2`, version
`0.1.45-local.0`. The earlier `/tmp/kamilio-safe-packages` cut snapshot was not
overwritten. No production fix was necessary after this workerd run. Later
output-worker edits are not included in the frozen artifact binding below.

- Installed consumer: `/tmp/safe-bash-551-local.33nrD5`.
- Fixture/bundle/config directory: `/tmp/safe-bash-551-workerd.dcSVhW`.
- Machine-readable receipt: `/tmp/safe-bash-551-workerd.dcSVhW/evidence.json`.
- Raw PASS log: `/tmp/safe-bash-551-workerd.dcSVhW/workerd.log`.
- Graph: `/tmp/safe-bash-551-workerd.dcSVhW/meta.json`; inspected input listing:
  `/tmp/safe-bash-551-workerd.dcSVhW/public-inputs.txt`.
- Resolved public entries and hashes:
  `/tmp/safe-bash-551-workerd.dcSVhW/public-binding.jsonl`.
- Pack metadata and installation output: `pack.json` and `install.log` in that
  same fixture directory; all three installed package versions are `0.1.45-local.0`.
- Initial setup failure is preserved in `workerd-permission-red.log`: fixed UID
  1000 could not read the temporary directory owned by UID/GID 150124. The rerun
  used `--user 150124:150124` and kept the same fixture/package bytes. This was
  a test-environment permission failure, not a product matching failure.

The actual invocation was the documented no-network/read-only container command
with `ACCEPTANCE=/tmp/safe-bash-551-workerd.dcSVhW`, current UID/GID 150124, and
image `sha256:6e6261159fd399ebe5a3d556b7d89da9c85c873f3f270918aad6c8107da8b411`.
The executable was `/tmp/safe-bash-551-tools/node_modules/workerd/bin/workerd`,
npm version `1.20260904.1`, reporting `workerd 2026-09-04`. Its SHA-256 is
`b6abddb03d3e3a3ae1d8443ede78cdb8ec1817f0aa236e9b2b2835f09d91fea1`.

Artifact SHA-256 bindings:

| Artifact | SHA-256 |
| --- | --- |
| safe-bash tarball | `2de02f6862c1519436df62f8f2104eae18722ccfb9008a6e62fcffcb6d124150` |
| safe-fs tarball | `586b8137c414a832b1cae35386f779209826d92f71e50dac26444b818eb3bf91` |
| safe-js tarball | `e4a878f7af036f1fbcbb27dbf0c95d7f857a834aa297c9e601e90d66b6a64628` |
| installed safe-bash browser entry | `24a37fc1ac06d0dd2a55c08ce858bfc6f623331fe172cbd09f4d38c5d55bb9ad` |
| installed safe-fs core entry | `31668d27c7d8507f89230a077d9c7643e7da16ca4508776847e1ad687a50ed0d` |
| bundled workerd fixture | `28fd617f32c04d542cf0785bbb6d506f6e668f39de5bf17f1aae770dbb59120b` |
| workerd PASS log | `1c2fa1dbdfdd33f0d955ef1e4029360a37d2226d59fb830cfc1cfa67d8b6111c` |

The installed browser entry exactly matches the frozen artifact directory's
entry. The graph contains the installed public safe-bash/browser and canonical
safe-fs/core artifacts, with no repository source substitution or unresolved
imports. Workerd ran without Node compatibility flags or global Node/browser
Worker constructors. The container exited and no acceptance container remained.

Observed cases were six successful stdin/VFS/pipeline commands, four adversarial
grep/rg work-limit/deadline cases, active cancellation and active disposal, and
three output/step/pattern budget cases. Both active interruption cases recorded
281 cumulative charged work units, `interruptedActive: true`, one created and
one terminated endpoint, and zero active jobs, pending jobs, or listeners. The
work-limit profile enforced 512 units per request; its 537-unit evidence total
includes the separate initial validation request rather than exceeding one
request's ledger. Every adversarial case also checked subsequent benign reuse.

Separately, the final live-source regression command passed **65/65**, with no
skips, cancellations, or failures; it is not a tarball-bound test claim:

```sh
node --import tsx --test \
  packages/safe-bash/tests/commands/regex-execution/provider.test.ts \
  packages/safe-bash/tests/commands/regex-execution/portable.test.ts \
  packages/safe-bash/tests/commands/regex-execution/executor.test.ts \
  packages/safe-bash/tests/commands/regex-execution/commands.test.ts
```

Raw regression log: `/tmp/safe-bash-551-regex-final.log`. This run used escalation
so tsx executed and reported all individual cases rather than the sandbox's
misleading file-only count. Earlier maintained typechecking reported failures
outside this assignment as well as subsequently corrected local type issues;
this acceptance does not assert an all-repository typecheck or full-gate pass.
Root still must repeat the released-package commands above after publication.

## Changed paths for the issue 551 assignment

No README, shared test-registration, package manifest, or build-configuration
changes were made by this assignment. Node/browser API exports share one public
barrel. Sed is reused unchanged through the portable command plugin.

- `packages/safe-bash/src/browser.ts`
- `packages/safe-bash/src/index.ts`
- `packages/safe-bash/src/commands/grep.ts`
- `packages/safe-bash/src/commands/regex-execution/client.ts`
- `packages/safe-bash/src/commands/regex-execution/portable.ts`
- `packages/safe-bash/src/commands/regex-execution/protocol.ts`
- `packages/safe-bash/src/commands/regex-execution/provider.ts`
- `packages/safe-bash/src/commands/regex-execution/public.ts`
- `packages/safe-bash/src/commands/search/glob.ts`
- `packages/safe-bash/src/commands/search/grep.ts`
- `packages/safe-bash/src/commands/search/matcher.ts`
- `packages/safe-bash/src/commands/search/output.ts`
- `packages/safe-bash/src/commands/search/portable.ts`
- `packages/safe-bash/src/commands/search/rg-command.ts`
- `packages/safe-bash/src/commands/search/rg.ts`
- `packages/safe-bash/src/commands/search/walk.ts`
- `packages/safe-bash/tests/commands/regex-execution/portable.test.ts`
- `packages/safe-bash/tests/commands/regex-execution/provider.test.ts`
- `packages/safe-bash/tests/integration/portable-search-workerd/config.capnp`
- `packages/safe-bash/tests/integration/portable-search-workerd/provider.mjs`
- `packages/safe-bash/tests/integration/portable-search-workerd/worker.mjs`
- `packages/safe-bash/docs/PORTABLE_SEARCH.md`
- `docs/plans/portable-search-workerd-acceptance.md`
