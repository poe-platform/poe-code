# Independent timestamp-helper verification

This is a different verifier, not the helper author. Ownership is confined to this
new subtree. No production, original test, author helper/evidence, contract,
root configuration or qualified-release runner is changed.

**Bounded acceptance:** helper commit `456a0738b0d2dc130ebbd9b7ccf5e299bcf177da`
passes the unchanged 13 consumers, 19 author regressions, 20 independent controls
plus 3 killed test-only mutants, and 5 unchanged postcondition tests. The separate
HEAD-at-run candidate `8e1298b02966a1a2344d81c04f3eddd906828682` has the same results.
Neither statement is a whole-release gate or general WebDAV-server certification.

## Reproduction

Use a new label. These commands run only bounded consumers and postconditions:

```sh
node tests/fs/webdav/release-timestamp-independent/run.mjs new-helper456 456a0738b0d2dc130ebbd9b7ccf5e299bcf177da candidate
node tests/fs/webdav/release-timestamp-independent/run.mjs new-current HEAD candidate
```

`HEAD` resolves once at invocation; the full result is saved in `baseline.json` and
`summary.json`. It does not mean old source `02a78bf…` or the current working tree.
Candidate mode requires the exact helper456 bytes and unchanged original consumers
and WebDAV production inputs. A later helper change requires a new review, not
silent substitution. The independent test/loader/runner bytes are SHA-256 pinned.

Historical reproduction remains red, with nonzero process exits:

```sh
node tests/fs/webdav/release-timestamp-independent/run.mjs new-original 02a78bf64c29dedcd69071551ed5848b0765c107 original
node tests/fs/webdav/release-timestamp-independent/run.mjs new-before 96e051e81312c7d33d8f4f5078efa09a4dd87947 red
```

`original` runs the original 13. `red` also stages the exact committed author19
against the original helper. Neither profile waives failed expectations.
`node tests/fs/webdav/release-timestamp-independent/seal.mjs` audits the recorded
cohorts, current verifier hashes, retained historical raw evidence and cleanup.

## Isolation and data classification

Each replay archives committed source, builds in a fresh owned `.work-*`, packs
without lifecycle scripts, and extracts into `node_modules/virtual-bash` inside
the distinct `webdav-independent-timestamp-verifier` package. Strict NodeNext
compilation checks the four original `.mts` files and, in candidate mode, the new
canonical `independent.test.mts`, against the extracted declarations. This file is
not runnable in place: the runner stages the unchanged helper beside it.

The runtime uses plain Node with filesystem reads restricted to that consumer,
no filesystem-write permission, no source loader and no repository self-reference.
The load hook hashes actual loaded module bytes; `runtime-closures.json` separates
each executed packed cohort. The unchanged postcondition5 is a separately labelled
strictly typechecked source test in the isolated archive, not a packed consumer.

Only installed TypeScript/tsx and Node builtins are used. No dependencies, private
packages, downloads, global configuration, shared `dist`, native provider service
or unowned temporary paths are written. HOME, npm configuration/cache and temporary
files stay inside the owned workspace. Helpers close loopback servers; runners
remove owned workspaces in finally. No service subprocess is launched.

`evidence/**/inputs/*.txt` contains captured source data, including `.mts.txt` and
`.ts.txt`; it is not canonical TypeScript or test discovery input. Original raw
logs, including independent harness-development failures, are immutable. See
`REPORT.md` for exact counts, classification and remaining limits. Faraday retains
ownership of release configuration, inventory and qualified-release orchestration.
