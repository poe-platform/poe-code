# Exact candidate provenance — August 27, 2026

This sidecar closes the missing **commit-object bytes** gap for the accepted
aliases/column package. It does not change product code, frozen expectations,
the rejected frozen runner, or the accepted independent review. No release gate
or public-consumer execution is performed by this sidecar's validation.

## Durable inputs and identities

- Accepted base and sole candidate parent:
  `0123c83d3aae72a15621acbb29a165b97b2c6ab6`.
- Production author, supplying the four root/package/plugin blobs:
  `cb940da68052a9f1ab7e115279900d277e051fdb`.
- Precise reachable fixture/harness author snapshot, supplying the ten remaining
  integration blobs: `0bd5c20bd19b3993e2ec9eb48b2a00dcd9ffba44`.
- Reachability anchor: accepted independent review
  `316b7efe5b94178271fc983edbdb33a08f4bb8ca`. Both authors, the accepted base,
  author evidence `899b3d7b8a81f094e7a7feae89f307eebade5480`, ledger
  `ce2729f55be7e74fd53e73833eed249e4a8f9b1e`, and original fixture freeze
  `dbceec2b9890927ea93cee3b416f78908c648cc6` are ancestors of this anchor.
- Exact reconstructed tree: `badd2ec61bdbfcbf977f0c682cb5683f2f6dcebe`.
- Exact reconstructed commit: `3dc0ac26d681badfd4db6319f2630274095c3100`.
- `candidate.commit.raw`: exactly **604 bytes**, captured with
  `git cat-file commit`, not formatted `git show` output. SHA-256:
  `a4a1a8e2eec383444e26fc553d7b2783645d1c362c40602a9c745e447daa15c3`.
  `.gitattributes` disables newline conversion for these raw bytes.
- Reconstructed Git source archive SHA-256:
  `6ce3c1fa2e2520e9931241b9e0a229394db4b7ac1291c940f68890362ee1348f`.
- Rebuilt npm package SHA-256:
  `994dca37308937059b1adacade54f24bd8227589ad65c46c7f4fb661c702c9d5`
  (648636 bytes, 738 entries).

`MANIFEST.json` enumerates all fourteen paths, their exact modes, Git blob IDs,
SHA-256 content hashes, and source commits. The candidate has only the accepted
base as its parent: **neither author nor review is falsely made its ancestor**.
The two author snapshots are blob donors, not merged trees. Concurrent
tree/regex/du changes in their larger snapshots are not imported.

The raw commit is stored as ordinary tracked file content. Its candidate commit
object need not survive garbage collection and need not be reachable from any
branch. Reachable base/author objects and these 604 bytes suffice to recreate it.
Keep this provenance commit in the history being cloned. No new public branch,
tag, replacement ref, or bundle is needed.

## Reconstruct and rebuild from a clean clone

Use a full clone containing this provenance commit and the review anchor above;
a shallow or filtered clone missing prerequisites is insufficient. A local clone
can use `git clone --no-local --no-checkout SOURCE DESTINATION` to avoid copying
loose objects or hardlinking them; check out the provenance commit in that clone.
The reconstruction itself never uses mutable HEAD to choose candidate inputs.

From that clone:

```sh
sidecar=tests/integration/aliases-column-public-independent-20260827/candidate-3dc0ac26-provenance
scratch=$(mktemp -d)
node "$sidecar/verify-evidence.mjs"
node "$sidecar/reconstruct.mjs" \
  --repository "$PWD" --output "$scratch/exact reconstruction"
```

The output's parent must already exist; the output itself must not exist and
must be outside the input repository. Spaces and a relocated copy of the
three runtime inputs (`reconstruct.mjs`, `MANIFEST.json`, `candidate.commit.raw`)
are supported and were exercised. All writes, downloads, indexes, object files,
builds, and generated adapters are in that new output. The input repository is
read only. No source or dependency fallback into its working tree is permitted.

For object reconstruction without installing dependencies or building:

```sh
node "$sidecar/reconstruct.mjs" \
  --repository "$PWD" --output "$scratch/objects only" --mode objects
```

### Reconstruction procedure

1. Authenticate the raw body by byte count, SHA-256, and the Git SHA-1 object
   header (`commit 604` followed by NUL). Check its exact tree and sole parent.
2. Export **only** the review anchor's transitive reachable closure using
   `git pack-objects --stdout --revs`, with the full anchor ID on stdin.
   Import that pack into a new, initially empty scratch object database using
   `git index-pack --stdin`. There is no `--all`, reflog traversal, object-file
   copying, alternates, shared hardlinks, or candidate ref. The input can contain
   the detached candidate locally; it still does not enter this transfer.
3. Require `git cat-file -e 3dc0ac26d681badfd4db6319f2630274095c3100^{commit}`
   to fail **before** reconstruction. Check no refs/alternates/shallow metadata,
   independent regular object files, and full reachable-object integrity.
4. Prove each provenance anchor is an ancestor of the fixed review. With a
   fresh external `GIT_INDEX_FILE`, run `git read-tree` on the accepted base.
   For each manifest entry, verify the donor's `git ls-tree` mode/blob/path,
   verify the blob's SHA-256, then run `git update-index --add --cacheinfo` with
   that exact mode/blob/path. No entire donor tree is overlaid.
5. Run `git write-tree`; require the exact expected tree and fourteen-path diff
   **before** importing the commit. Then execute, against the scratch database:

   ```sh
   git hash-object -t commit -w --stdin < candidate.commit.raw
   ```

   Require the exact candidate ID; compare `git cat-file commit` bytes and tree,
   run full object integrity checking, and verify that no refs were created.
6. Archive the reconstructed candidate's `src`, `package.json`,
   `package-lock.json`, `tsconfig.json`, `tsconfig.build.json`, and **README.md**.
   Compare the entire archive with the accepted captured archive. Install the
   reconstructed lock using isolated `npm ci --ignore-scripts --no-audit
   --no-fund`; compile with that installed compiler and run
   `npm pack --offline --ignore-scripts --json`. Require the accepted SHA-256
   and byte equality with the previously accepted captured package.

Missing objects or tool mismatches are failures, not fetch-from-loose-object
fallbacks or inferred passes. `REPORT.json` and numbered step records retain
commands, environment, stdout/stderr, exits, signals, binary-output hashes,
tool identities, source/dependency inventories, and failures. Scratch data is
not automatically removed. Deleting it later does not remove these instructions
or their committed validation evidence.

### Prerequisites and limits

The measured build profile is **Darwin arm64, Node 22.22.2, npm 10.9.7,
TypeScript 5.9.3**. Build mode enforces the recorded Node binary hash and versions,
compiler hashes, and all captured Node/undici declaration file hashes. This
deliberately does not certify another operating system or executable profile.
`--npm-cli /absolute/path/to/npm-cli.js` can explicitly select the installed npm
CLI; otherwise the npm adjacent to the running Node is resolved and hashed.
Git and tar are required at `/usr/bin/git` and `/usr/bin/tar` and are recorded.
Object-only mode does not enforce the measured build tool hashes.

`npm ci` needs access to the lockfile's public registry URLs. Its initially empty
cache, home, and npm config files are scratch-owned; ambient npm credentials,
Node options, Git object overrides, and user/global Git configuration are not
inherited. No existing `node_modules` is used. Install scripts are disabled;
unused development tools are installed only as specified by the original lock.
Dependencies and tool binaries are not vendored here: future registry/tool
availability remains an explicit prerequisite, not a offline-clean-clone claim.
Allow roughly a gigabyte of temporary space per full run.

## Captured replay versus fresh rebuilding

`verify-evidence.mjs` authenticates the compact new validation capture without
running Git reconstruction, npm, product code, the original runner, or consumers.
It does **not** re-execute historical results. The build command above does perform
a fresh deterministic reconstruction/install/build/pack; these are distinct modes
of evidence, not interchangeable claims.

The existing 122-file capture remains unchanged at the fixed review anchor,
archive SHA-256
`3f4dc4918bb19fad05f97d281c9d532e5bd9f0b106a47177e7aba4bc01b3ec85`.
The build adapter authenticates and extracts it without duplicating it in this
sidecar. Its recorded `finalize-evidence.mjs` mapping is restored as follows:

| Captured input | New scratch destination |
| --- | --- |
| `frozen/fixtures.tar` | `repository/tests/integration/aliases-column-public-independent-20260827/` (all 11 unchanged files) |
| `frozen/report.json` | `frozen-inputs/report.json` (historical rejected result) |
| `frozen/consumer-inputs/*` | `frozen-inputs/consumer-moved/*` |
| `review/declaration.json` | `external-replay/declaration.json` |
| `review/supplemental.mjs` | `external-replay/supplemental.mjs` (byte-identical) |
| `exact/virtual-bash-0.0.0.tgz` | `external-replay/author-raw/package/virtual-bash-0.0.0.tgz` (identical accepted bytes) |
| `review/exact-artifact-review.mjs` | `external-replay/exact-artifact-review.relocated.mjs` |

Only the external harness's three `output`, `repository`, and `frozen` location
declarations change. Reversing those exact three edits must restore the original
script bytes. `relocation.json` records them. The harness already replaces the
captured TypeScript `typeRoots` with its new consumer-local directory; neither
type settings nor assertions are otherwise modified. Its new repository has
the reconstructed object, source, and freshly installed tooling. The old
hardcoded scratch paths are historical data, not executable prerequisites.

The generated external driver and unchanged supplemental script are syntax
checked. **No consumers were rerun** in this provenance task. The optional command
in `relocation.json` can execute the external exact-artifact consumer replay later
under separate authorization; its output directory is single-use. It is not a
claim that relocated consumer execution was measured here. Never execute or
modify `run.mjs` or the original eleven frozen files as part of this task, and
never run the historical finalizer against the user repository.

## Preserved chronology and validation

The original frozen runner produced a 737-entry pack with SHA-256
`40fe53856586ee115446591c6afb2f0d05c38d3e3302f89f84aa323ba936c8d9` because it
omitted README. Its **REJECTED exact-artifact admission** and original 56/56
results remain intact. The separate accepted exact-pack review's 56 unchanged
checks plus four supplemental checks remain historical accepted evidence.
This new package reconstruction neither rescores nor merges those results.

`VALIDATION.json` and its bounded raw capture record two successful exact builds,
including a relocated sidecar/output with spaces, absent-before/present-after
controls, all fourteen donor bindings, and four negative provenance controls.
The first successful run's surrounding zsh exit-capture wrapper failed because
`status` is read-only; the corrected second wrapper captures exit zero. An earlier
preparation helper exceeded Node's default stdout buffer while reading the large
index, before creating any sidecar file; it was retried with a 64 MiB limit.
Both tooling issues are disclosed, not candidate failures or hidden retries.
No additional missing objects arose in either reachable-only reconstruction.
This is an isolated object-database proof from the fixed reachable review closure,
not a measurement of every file in a full clone or any global release gate.
