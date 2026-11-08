# Independent pruning adversarial acceptance

This directory owns only new verifier files. Product, filesystem, contract and
existing tests are read-only inputs. It does not run the original3758 runner,
revised96, consumer61 or any other author's suite. No `.test.ts` files, emitted
JavaScript siblings, runtime dependencies, native utility oracles or product
subprocesses are added.

## Reproduction

Run from the repository root after source owners have committed their changes:

```sh
node --import tsx tests/commands/diff-patch-stress/pruning-adversarial/run.ts tests/commands/diff-patch-stress/pruning-adversarial/evidence.json
node_modules/.bin/tsc --noEmit --target ES2023 --lib ES2023 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --skipLibCheck tests/commands/diff-patch-stress/pruning-adversarial/run.ts tests/commands/diff-patch-stress/pruning-adversarial/pruning.acceptance.ts tests/commands/diff-patch-stress/pruning-adversarial/harness.ts
```

The dedicated runner dynamically imports the acceptance module only **after**
hashing every source file, its own TypeScript fixtures and the imported WebDAV
mock. It compares complete before/after inventories and SHA256 values, refusing
changed inputs. Final mode refuses a dirty source tree. `--exploratory` permits
diagnostic work against an explicitly nonfinal tree; it does not disable hash
checks. The original70 test-file discovery and bytes are independently compared
to Git reference `4d4f5ca`, then checked again after the run. Git is used only by
the verifier for provenance; no shell/native utility runs inside product code.

Each execution has a five-second cancellation deadline and the whole runner has
a 120-second hard deadline. Cases run sequentially in fresh fixtures. The report
contains commands, exact patch stdin, binary hex payloads, complete visible and
backing-layer namespaces, ordered operation/error traces, provider requests,
source/fixture hashes and per-backend/action counts. File metadata timestamps
are intentionally not namespace equality fields. Only verifier-created Node
temporary directories are cleaned up.

## Acceptance matrix

The final normal matrix has **200 checks**: 191 public `Shell` executions using
the real `standardCommands()` and `diffPatchCommands()` plugins, plus nine direct
typed filesystem-capability probes. Successful assertions for an unsupported
backend mean **honest refusal**, not successful directory pruning.

| Backend | Capability | patch | rmdir | rm -d family | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Memory | 1 | 16 | 15 | 18 | 50 |
| Real, isolated Node temp root | 1 | 16 | 15 | 18 | 50 |
| Mount over Memory | 1 | 9 | 9 | 9 | 28 |
| Overlay, created/opaque upper | 1 | 8 | 8 | 8 | 25 |
| Overlay, static lower/merged | 1 | 2 | 2 | 2 | 7 |
| Mock S3 | 1 | 4 | 4 | 4 | 13 |
| Mock WebDAV | 1 | 4 | 4 | 4 | 13 |
| Missing optional method | 1 | 2 | 2 | 2 | 7 |
| Read-only wrapper | 1 | 2 | 2 | 2 | 7 |

- Seventy-two child-insertion cases use fixed seeds `17,90,803,1230,6007,65520`,
  deterministic microtask delays, flat/nested child paths and bytes containing
  NUL, invalid UTF-8, CR and LF. Both `rm -d` and `rm -df` occur. Memory and Mount
  insert at the backing empty-only primitive. Real inserts immediately before
  Node's actual `fs.promises.rmdir` syscall wrapper, after RealFS path checks;
  the exact temporary root is canonicalized and the builtin restored after
  every case. Overlay upper probes instrument its underlying Memory primitive,
  after the overlay's merged listing, rather than reentering its serialized lock.
- Complete namespaces, not just an exit code or one sentinel, must equal the
  exact allowed changes. An inserted child must remain visible with identical
  bytes even after errors or cancellation. Real's containing host sandbox also
  records a sibling outside the configured root; S3 records an unmounted prefix;
  Mount records its independent root backend; Overlay records upper and lower.
- Core directory-only calls cannot invoke `rm`. Patch may unlink its selected
  file before pruning. No consumer may request recursive removal. Overlay's
  existing private staging cleanup during that earlier file unlink is recorded
  separately: only its UUID staging root may be recursively cleaned, before
  pruning begins. No recursive deletion is accepted during pruning.
- Missing optional support, S3 prefix emptiness and WebDAV collection emptiness
  produce explicit unsupported errors. Core unsupported operations leave the
  whole namespace unchanged. Patch unsupported pruning reports failure **after
  its target file was already deleted**. That is an honest partial commit, not
  rollback. Remote DELETE/deleteObject traces permit only that selected file,
  never a directory/prefix delete during pruning.
- Permission and I/O failures are injected at the filesystem boundary for local
  adapters and as actual denied/failed requests in the safe S3/WebDAV mocks.
  Typed `FsError.code` is checked at filesystem boundaries; shell assertions
  check status and meaningful human-readable diagnostics, not a required errno
  serialization format.
- Cancellation includes pre-aborted input and boundary abort reasons carrying
  `ENOENT` or `EIO`. The `-f` path must not convert cancellation into success.
  Signals are required at every attempted empty-only primitive. Cancellation is
  not rollback and does not forcibly stop arbitrary host work.
- Final symlink and patch-selected ancestor symlink fixtures retain external
  bytes; `rm -d` keeps ordinary symlink-unlink semantics. Root checks avoid any
  root `rmdir` call. Mount's empty-root patch fixture really reaches `/volume`
  and requires typed `EBUSY`, after the selected file deletion. Ordinary file
  `rm`, explicit recursive `rm -r` and nonrecursive directory rejection remain
  separately checked.

## Overlay checkpoint reconciliation and limitation

The early exploratory matrix expected `ENOTSUP` for static lower-backed empties
based on source checkpoint `3a9177a`. While this verifier was running, filesystem
owner commit `50f517d` deliberately added static lower/merged removal through
whiteouts. This verifier inspected the actual implementation and independently
read both current and `3a9177a` versions of `src/fs/overlay/README.md`: an immutable
lower and an exclusively owned upper were already lifetime prerequisites.
Consequently the four old static-empty refusal expectations were wrong for the
new checkpoint. They were explicitly replaced with positive static support and
exact visible/lower namespace assertions; no remote unsupported case was waived.

The separate raw-lower mutation probes deliberately **violate** that immutable
lower prerequisite. They insert a lower child immediately after the merged
listing captured an empty result. On `50f517d`, all three actions return success
and hide the child through a whiteout, although its physical lower bytes remain.
The initial urgent status called this an in-contract bug; that classification
was retracted after checking the preexisting ownership contract. The observation
is retained and is **not** successful child preservation or general race safety.

Reproduce the three failing, out-of-contract safety probes separately:

```sh
node --import tsx tests/commands/diff-patch-stress/pruning-adversarial/run.ts tests/commands/diff-patch-stress/pruning-adversarial/outside-contract.json --outside-contract
```

This command deliberately exits nonzero for the observed **0/3 child-preservation
outcomes**. Those failures are not included in the normal 200 acceptance checks
and are not relabeled as successes. `overlay-observation.json` retains the earlier
191-check diagnostic run (184 passed, seven failed: four static-expectation
mismatches and three raw-lower visibility losses) with its exact source hashes.
It is exploratory provenance, not final source acceptance.

## Limits

No native GNU or Bash utility was executed by this worker. GNU patch's broad
rmdir-error suppression is not this acceptance policy: preserving
`ENOTSUP`/`EACCES`/`EIO` is the explicitly requested, documented divergence. This
does not establish universal GNU/BSD parity, remote provider interoperability,
security against outside-contract RealFS host path swaps, externally shared
overlay safety, full-shell completeness, superiority or 72 hours of work.

Overlay backing-upper insertion is an additional hostile-boundary observation;
it is not permission to share an upper between writers. The lower-mutating
counterexample explains why the ownership prerequisites cannot be dropped.
Remote mocks prove safe refusal and injected error propagation, not provider
support for atomic empty-directory removal. Method presence is not capability
proof. No source fixes are owned by this verifier.

## Recorded final proof

At committed source HEAD `77f859182e6bc9d1ea3dbf26852d529e77ea65ff`, the normal
dedicated runner passes **200/200**. The separate out-of-contract probe records
**0/3 child-preservation outcomes** and exits 1, as described above. Source,
fixture and original70 hashes remain stable across each run; all original70
files also match `4d4f5ca`. See `evidence.json`, `evidence.log`,
`outside-contract.json`, `outside-contract.log` and `typecheck.log`.

Consumer source commit: `4009efeef1ab909b4a5c8ffa7dbebc335dd9325c`.
Consumer SHA256: `3a06d5b33d3c0df12ff83b0bbf4396d90906d6fd61e3ca1bd5537f508c4282af`.
Overlay SHA256: `e77e44db220023f55b70ad936f19f9bd150d2872f3e3758837929994b2762f28`.
The final source includes static-overlay commit `50f517d`; the root's earlier
consumer release marker alone did not establish this later overlay behavior.
Scoped TypeScript checking of all three verifier files and their imported
product/mock dependencies uses `--noEmit`; it is not a whole-repo typecheck claim.
