# Preserved harness failures

## Attempt 1: documentation mistaken for algorithm changes

Source b7ae676a57adec1193b51fe08a91b17eac6f5884; helper 7b549da.
The unchanged-algorithm check accidentally compared entire family directories,
including README.md. Its actual diff contains only the two approved availability
documentation updates. This failed before compiler/build/pack/product/native
execution. The correction records the full changed-path list separately and
requires zero TypeScript diff across both complete family trees. No fixture,
expected byte, classifier or product source is changed.

Raw original report remains under
`/tmp/safe-bash-stream-five-public-verifier.29433-packed-1/report.json` and is
preserved as `evidence/packed-attempt-1/report.json` in this owned subtree.

## Attempt 2: lexical regex was not an import parser

The isolated actual npm build and offline pack passed. Before product runtime,
the closure scanner matched ordinary command option text containing `from` as
an import, then falsely reported an external dependency. The scanner now uses
the already copied and hashed development TypeScript parser to inspect import,
export, import-type and require/import call nodes, rejecting nonliteral calls.
It still requires every real product JS/declaration edge to resolve inside the
packed dist or to an inspected builtin. No dependency was installed, no product
or fixture changed, and no runtime check was counted from this failed attempt.
The raw original report is preserved in `evidence/packed-attempt-2/report.json`.

## Outer release attempt 1: Darwin /tmp alias comparison

The exact committed npm command correctly propagated exit78 for the copied
missing chmod asset, before product tests. The verifier then rejected the
reported run directory because Node canonicalized `/tmp` to `/private/tmp`,
while the verifier compared an unresolved spelling. The correction compares
against realpath(authenticated workspace), retaining the strict descendant
requirement. No release script/native pin/product/input change is involved.
Original outer stdout and raw author result are preserved under
`evidence/release-attempt-1/`; the full original verifier report remains in its
immutable temporary attempt directory. This failed attempt is not a positive
qualified-release pass.

## Packed attempt 3: emitted builtin type aliases

The AST scanner correctly found TypeScript-emitted `import("util").TextEncoder`
and TextDecoder declarations in dist/commands/internal.d.ts, plus bare `path`
in the POSIX path declaration. These are legitimate Node builtin aliases, not
external packages. It had required the `node:` spelling even for declarations.
The correction recognizes Node's isBuiltin and still requires the canonical
name in the same inspected allowlist. Build/pack passed; no packed runtime
fixture or type check ran before this harness rejection. Failure details and
full original-report hash/path are retained in `evidence/packed-attempt-3/`.

## Outer release attempt 2: native scratch inherited an unauthorized group

The exact outer command correctly rejected missing/wrong copied prerequisites
with exit78, then failed the positive canonical gate at 316/318 and native20/22.
Both failures were chmod directory setid cases. These are retained failures,
not counted as passes and not evidence of universal native parity.

The newly created `/tmp` archive inherited gid0 (wheel); uid501/gid20 is not a
member of group0. The canonical repository's metadata directory has gid20.
The original failing `6755`, `+2000`, directory row was reproduced unchanged:
inherited gid0 returns native EPERM both without and with the network sandbox;
the same row in a newly created gid20 directory passes under the same sandbox.
Node's initial chmod6755 measured4755 under gid0 but6755 under gid20. This is
host-specific evidence, not a product-API requirement or a diagnostic waiver.

The verifier now aligns only its NEW isolated output root to the canonical
reference directory's gid, after asserting membership, and records that setup
plus actual extracted metadata-directory gid. It preserves the network/write
sandbox, exact outer command, source, all318 tests, all82 native stream inputs,
strict classifiers and original host pins. Prior attempts/native artifacts
remain unchanged. `native-group-control.mjs` and its raw evidence reproduce the
profile distinction; no new corpus row is counted. Full positive replay remains
required after this disclosed harness-environment correction.

## Outer release attempt 3: setup itself inside sandbox strips setid

Aligning the inherited group alone did not qualify the native run: 316/318 and
20/22 again. The earlier control initialized modes OUTSIDE the sandbox, so its
passing gid20 case did not isolate the complete native fixture lifecycle.
`native-setid-child.mjs` repeats the exact existing first failure with creation
and initial chmod inside the child. With gid20, plain execution measures6755 and
native +2000 exits0; network-sandboxed execution measures0755 and native exits1
with EPERM. This corrects the earlier incomplete causal claim, retaining both
the original group control and both full failed qualification attempts.

Native qualification must use the canonical unsandboxed host permission
profile, not a sandbox that changes the oracle's permission semantics. The
exact committed outer npm command now runs in the same authenticated isolated
workspace without sandbox-exec, with explicit C/UTC and npm offline settings,
copied/hashed tooling and native assets, no downloads or network operations.
The committed outer scripts were inspected: only the existing bounded native,
compiler, package and local consumer workflows execute. Original pins remain
read-only by operation and are rehashed afterward; they are not chmod'd.

This boundary distinction is explicit: the independent packed consumer STILL
runs under OS network and repository/build-read denial with actual failing
controls. No claim is made that native qualification ran under that same OS
sandbox, nor are native failures waived or fixture diagnostics relaxed. Full
318/318 plus current82-input release success remains required.
