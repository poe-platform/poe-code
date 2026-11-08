# External oracle prerequisites

Root authorized only two generated owned payloads to move out of this publication:

| Original corpus-relative path | Bytes | Mode | Exact local external file |
| --- | ---: | --- | --- |
| `sealed/oracle/tree` | 114488 | `0755` | `/tmp/safe-bash-tree-external-oracle-TbVJVK/tree` |
| `sealed/oracle/tree-2.2.1.tar.bz2` | 56345 | `0644` | `/tmp/safe-bash-tree-external-oracle-TbVJVK/tree-2.2.1.tar.bz2` |

`EXTERNAL-ARTIFACTS.json` binds their full SHA256, primary upstream archive/manual
URLs, original build command, compiler and Darwin/C/ASCII profile. The external
files are separate regular files, not symlinks/hardlinks to the repository or
original private corpus. Exact bytes/modes were checked before removing only the
two repository copies. The original complete private corpus remains unchanged at
`/tmp/safe-bash-tree-hidden-prep-vyzfHc`; no other artifact was relocated.

**The repository does not contain all inputs.** Original manifests still name
these two absent paths and retain their original hashes. Historical statements
that all 97 sealed artifacts were locally present/verified describe the state
before this externalization. They are not rewritten or promoted to current
in-place verification. The remaining corpus, native20 captures, initial raw38,
v1/HOLD, v2 and final38 evidence are unchanged.

## Integrity-only verification

This additive helper imports Node builtins only. It never invokes product,
native tools, tests, downloads or a build:

```sh
node tests/commands/filesystem-inspection-stress/tree/external-artifacts.mjs --verify
```

It checks the two exact external prerequisites plus every reference in the
original/v1/v2/final/receipt manifests and original sealed inventory. It reports
repository and external references separately. Missing or wrong bytes, kind,
mode or unexpected repository binary presence is a failure, never a skip/pass.
For an independently retained identical copy, set `TREE_EXTERNAL_ORACLE_DIR`;
that changes only the local lookup directory, not expectations or hashes.

## Qualified legacy verification

Do not run old in-place verification against an incomplete checkout or restore
binaries into this repository. The bounded helper can instead create a fresh
`/tmp/safe-bash-tree-restored-*` directory with **independent regular file copies**
and restore the two exact prerequisites at their original corpus-relative paths:

```sh
node tests/commands/filesystem-inspection-stress/tree/external-artifacts.mjs --restore
```

This command is documented for recovery; it was **not run during packaging**.
It first verifies all mapped inputs, permits at most 1024 file/symlink entries,
256 directories, 8 MiB per regular file and 32 MiB total file/target bytes, and
creates only a fresh direct `/tmp` child. The 12 intentional fixture symlinks
remain exact relative fixture symlinks, never aliases to the live repository;
source, runner and external oracle payloads are independent regular files.
No preexisting destination is reused. Failure leaves an explicitly incomplete
scratch directory, not a reported success. The helper then verifies the original
manifests against the fully restored copy without external substitution.

Only after a separately authorized verification window may the unchanged checks
be run at the returned `restoredDirectory` (commands below **not run here**):

```sh
node --test "$RESTORED/verify-evidence.test.mjs"
node --test "$RESTORED/evidence/final-436bda3/verify-final.test.mjs"
```

Those read captured evidence rather than replay tree. The older
`sealed/verify.mjs` additionally hardcodes the original repository seal and
`/tmp/safe-bash-tree-holdout-prep-detail.txt`; it is not advertised as portable.
Never change its assertions or silently supply unrelated missing inputs.
No product/native replay is authorized by recovery documentation.

## Recoverability limits

`/tmp` is local, ephemeral storage, not durable distribution. The recorded primary
source URL may allow future archive recovery, but its availability and future
byte stability were not rechecked here; the pinned archive hash is mandatory.
The exact Darwin arm64 binary has no asserted public download URL. Rebuilding
tree 2.2.1 with recorded compiler/flags is **not claimed bit-identical**; a different
binary cannot satisfy the old seal. If exact copies are lost, original full-input
integrity is unavailable, not green. Native captures can still be read as their
own unchanged historical evidence, without pretending the executable was found.

Current bounded final38 acceptance and standalone internal API paths are indexed
in `CURRENT-HANDOFF.md`. Root/public integration and the separately pending
source-safety six-case gate are not established by this packaging operation.
