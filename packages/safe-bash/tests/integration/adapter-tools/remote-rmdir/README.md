# Frozen original79 baseline and remote-rmdir handoff

## Observed baseline, not an assumed pass count

On August 27, 2026, the committed source **and** original matrix inputs at
`debb29ead94ae387f359d9d04b333ee4380f88d6`, built inside an isolated archive,
produce **79 tests / 77 pass / 2 fail / 0 cancelled / 0 skipped / 0 TODO**.
The original matrix still exits **1**. Its two failures are:

- `s3: create, copy, append, inspect and remove files`: `rmdir` returns
  `ENOTSUP` for `/work/scratch/nested`.
- `webdav: create, copy, append, inspect and remove files`: `rmdir` returns
  `ENOTSUP` for `/work/scratch/nested`.

The independent preflight controls pass **30/30**. The existing fixture installs
actual `agentCommands()` into a real `Shell`; its **22 named required commands**
are executable. No literal aggregate/default command count is asserted.

| Captured cohort | Matrix pass / total | Failure classification |
| --- | ---: | --- |
| `baseline-debb29e/` | 58 / 79 | 19 missing compiled regex-worker failures plus the two remote-rmdir failures |
| `baseline-debb29e-built/` | 77 / 79 | The two remote-rmdir failures only |

The first capture omitted the source-mode regex client's required compiled
`dist/commands/regex-execution/worker.js`. Its raw logs, manifests, archives and
result remain intact: it is an unbuilt-profile/harness-prerequisite result,
not a replacement baseline and not a product regression claim. The second
capture builds the **same archived committed inputs**, with no source or
fixture edit. It neither copies live `dist` nor imports live production source.
The first capture predates the build step in `capture.mjs`; each capture records
its actual runner hash and subprocess commands. The current runner produces
the built profile only and refuses to overwrite any existing cohort.

## Exact replay and fingerprints

The command actually used for the built capture was:

```sh
node tests/integration/adapter-tools/remote-rmdir/capture.mjs baseline-debb29e-built debb29ead94ae387f359d9d04b333ee4380f88d6 debb29ead94ae387f359d9d04b333ee4380f88d6 debb29ead94ae387f359d9d04b333ee4380f88d6
```

For a replay, change only the new cohort name; existing evidence is immutable.
The runner independently archives source/configuration, test inputs and the
WebDAV helper from the three explicit full commit IDs. It verifies every
extracted file against its committed Git blob and hashes bytes before and after
execution. It creates and removes only its own temporary archive directory
under this owned subtree. No dependencies are installed and no service replay
is performed. Source/configuration build succeeds using:

```sh
/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node /Users/kjopek/Workspace/safe-bash/node_modules/typescript/bin/tsc -p tsconfig.build.json
/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node --unhandled-rejections=strict --import tsx --test --test-reporter=tap tests/integration/adapter-tools/matrix.test.ts
/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node --unhandled-rejections=strict --import tsx --test --test-reporter=tap tests/integration/adapter-tools/preflight-review/preflight.test.ts
```

All three subprocess commands use the isolated archive as their working
directory, not the moving repository. Their exact original temporary paths,
times, statuses, TAP cases and failures are in the result JSON files.
The capture process exits zero when capture/integrity checks succeed; that
does **not** make its recorded matrix exit status zero.

| Fingerprint | Value |
| --- | --- |
| Committed `src` Git tree | `05ecc9d1c914bb7a959ba5a77f51e0820738d5d8` |
| All committed input manifest SHA-256 | `8f23448e026a03e1b8ec87f1784e2b73b4cc63a9f8b4d1f198b1c449c6661908` |
| Source/configuration manifest SHA-256 | `11ada26e691086a51f2c8929347511a4b99a4472dc1f74b259660945760983a3` |
| Original matrix/fixture/preflight manifest SHA-256 | `6f259e4705e7e504dec6849c8ef1c997829e0e8bedaf9d95fd2e3c271ae7cf15` |
| WebDAV helper manifest SHA-256 | `d636e8cacb636e08d57d45d0d1a33432cc6f9e50c1d18ea3145c907b5a876e18` |
| Generated build manifest SHA-256 | `7e1349f8e132f8d38240e66de2420cc3aa5b14887ba69fd221670f1a3ed9f254` |
| `source.tar.gz` SHA-256 | `b9871276bf4fee62983bac2be6626a430ca42a2881298fc212ad3af5fd2a5dcf` |
| `input.tar.gz` SHA-256 | `540620f175fe23252753b51f723debc2a382e857f406e3b0461edfcbac7e977c` |
| `helper.tar.gz` SHA-256 | `69f19140159bb724dd34df3f87f4e36598bd2a47acdbbd87cc55d8c127abb80e` |

The manifest fingerprint algorithm is SHA-256 of `JSON.stringify(entries)`;
`inputs.json` preserves the exact entry order and fields. Generated build
outputs are separately enumerated in `generated.json` and checked unchanged
after tests. Both captures contain byte-identical committed-input archives.

Environment: Node **v22.22.2**, TypeScript **5.9.3**, tsx **4.23.12**, esbuild
**0.28.2**, `@types/node` **22.20.1**. The platform, Node executable hash and
development-package metadata hashes are in `capture.json`. Existing local
development dependencies are reused; their entire installed trees are not
archived. `TSX_DISABLE_CACHE=1` and snapshot-local `TMPDIR` avoid a shared
transform cache. S3 is the existing in-process `MockS3Client`; WebDAV is the
existing `MockDav` behind the existing fixture's loopback HTTP server.
There is no external/native provider oracle here. Concurrent author activity
makes elapsed times execution metadata, not performance evidence.

## Follow-up after source authors and contract reviewer settle semantics

This checkpoint adds **no new acceptance tests yet**. Source semantics must
settle first; no source, contracts, root exports, `tests/fs`, original matrix
expectations, existing fixtures, or old reports are modified.

1. Receive explicit final combined source commit and reviewer conclusions.
   Inspect author-owned diffs and service evidence without duplicating services,
   dependencies or source work. Do not infer readiness from a moving worktree.
2. Run the built original79 again with final committed source and original
   `debb29e` matrix/fixture/preflight inputs and WebDAV helper. Preserve all 79
   names/assertions and compare **77/79 versus freshly observed totals**, not
   an assumed 79/79. A failure remains a failure; there is no cohort waiver.
3. Classify helper changes explicitly. The runner's third revision independently
   pins `tests/fs/webdav/mock.ts` and records its delta from the input revision.
   `src/fs/s3/mock.ts` is shipped source and also the fixture's S3 helper: its
   original bytes remain in the source archives and per-file manifest. Inspect
   its final diff separately; a changed MockS3Client must not be described as an
   unchanged-all-input replay. If needed, add a distinct original-helper control
   archive and a distinct author-helper-delta cohort within this owned subtree.
   Do not edit the original fixtures or overwrite baseline evidence to combine
   those profiles.
4. Add focused `acceptance.test.ts` here using existing `withFixture` and real
   Shell/`agentCommands()` dispatch, keeping its denominator separate from 79.
   The acceptance inventory is:
   - Successful empty explicit S3 marker and safely locked WebDAV collection
     removal via `rmdir` and directory-only `rm -d`, when the reviewed adapter
     path supports the operation; verify namespace effects and no child deletes.
   - ReadOnly wrappers over each remote adapter: denial, typed direct-boundary
     errors and unchanged backing bytes/namespace, with reviewer-set precedence.
   - Mount wrappers routing to each remote adapter: success, path/error/signal
     propagation and protected mounted roots. The original mount fixture's
     `/work` is real storage, so its success alone is insufficient.
   - Overlay with remote upper as well as remote lower: reviewed forwarding,
     empty-directory masking/removal, unchanged lower data and retained children.
     The original memory-upper/S3-lower fixture alone does not test remote-upper
     removal.
   - Nonempty directories, files/final symlinks where supported, missing paths,
     virtual/provider roots, provider authorization/IO/unsupported errors,
     pre-aborted and in-flight signals, including errno-shaped abort reasons
     under force flags. Assert command exit/output and typed FsError at the
     actual filesystem boundary, not errno serialization in shell stderr.
   - Deterministic child-creation/provider-failure interleavings using legitimate
     test hooks: preserve existing and newly arrived child bytes and namespace;
     never accept recursive deletion after an empty listing. Observe late
     rejections and do not assert that cancellation rolls back completed effects.
   - Missing optional `rmdir` and safely unsupported paths remain `ENOTSUP`
     without mutation. Supported-path acceptance does not make the optional
     contract mandatory or invent provider guarantees.
5. Run only the owned targeted checks from explicit frozen inputs; new safety
   tests may remain red, never skipped or weakened. Report matrix, new safety,
   helper-delta and author-owned provider cohorts separately. Commit exact owned
   paths atomically after evidence review.

Historical `preflight-review/evidence/` remains untouched, including its dirty
77/79 cohort. This new clean committed-source capture does not revise any old
report, full-suite gate, provider claim or superiority assessment.
