# Independent immutable nonregex baseline replay

Owned scope is only this new directory. This leaf worked independently without
redelegation. Product, root configuration, author tests, frozen inputs and oracle
receipts remain unchanged. The package name is still `virtual-bash`.

## Inputs and execution

- Candidate: `85675366efe962c0d52993bb8aa286dc9683f6a6`.
- Original independent freeze: `35aa8054ac0ebc1eacefc7cde63e4706f4c72137`.
- Author provenance marker only: `d96f9ffe7e23488c8b739b4e4fccdc88e13eb2ac`.
- Exactly 95 original inputs: GNU C 95 + GNU en_US.UTF-8 9 = 104 normative
  observations; separate original Apple 104. No extra semantic corpus.

`prepare.mjs` archives the candidate's entire `src` plus exact package/lock/build
configuration files into unique OS temporary storage. It authenticates the freeze
against its Git archive, replays the pinned native receipts with the unchanged
frozen runner, and builds only that candidate with existing development tooling.
The selected archive is not a claim to have run all committed candidate tests or
packaged all documentation. No live product/source/dist is loaded.

The build is packed and installed offline with lifecycle scripts disabled and an
isolated npm cache/configuration. After moving the installation, `adapter.mjs`
imports its authenticated `dist/commands/expr/index.js` file URL. The package has
no root expr export, public expr subpath, or default expr registration. The strict
standalone consumer verifies actual ESM root resolution and intentionally imports
the internal installed dist module; this is **not** public subpath acceptance.

`run.mjs` executes every original GNU tuple unchanged. `controls.mjs` exercises the
applicable frozen control specifications and all seven frozen Shell workflows.
Its 73 measurements are subchecks, **not** 73 fully accepted frozen specifications.
All six outer-worker observations remain NOT READY for regex safety: four bounded
dangerous inputs and two short-circuit inputs. No original regex row is removed.

## Commands

From the repository root, read-only committed-evidence verification:

```sh
node tests/commands/expr-stress/nonregex-review/verify.mjs
```

This verifies artifact hashes and complete file inventory, source/freeze Git
archives, exact comparator results, and preservation of mismatch exit 1. Exit 0
means evidence integrity, not candidate acceptance. It never captures or rewrites
evidence. `.mts.data` is explicit consumer source data outside canonical TS test
discovery, compiled only in the moved isolated consumer directory.

Full bounded replay, new temporary captures automatically removed on completion:

```sh
node tests/commands/expr-stress/nonregex-review/run.mjs
```

Expected exit is **1** for retained original mismatches. Build/native prerequisites
must exist; errors are failures, not skips. Required local GNU binary/archive pins
are those in the original freeze. No runtime dependency or main-project install
is performed. To explicitly retain a new unique temporary capture for inspection:

```sh
node tests/commands/expr-stress/nonregex-review/run.mjs --capture
```

That flag prints the unique path and requires subsequent owned-fixture cleanup.
`patchNew` refuses existing capture paths; no invocation writes committed evidence.

## Evidence interpretation

See `REPORT.md` for exact denominators, mismatches, controls and limitations.
`provenance.json` binds the final execution's source/build/installed manifests,
tool versions, native hashes, input receipt, adapter/harness hashes and commands.
Manifests are before/after enumerations including new files and directories, not
checks of only originally tracked paths. Source checking excludes its explicit
development-tool symlink and separately checked generated dist.

`evidence/attempt-01` preserves the first replay and control receipts, including a
lossless gzip/base64 provenance encoding. `evidence/attempt-02` records an ESM/CJS
adapter-resolution mistake, not a candidate defect. The initial outer-worker
inheritance mistake is separately retained. Final evidence does not silently
replace these attempts. No benchmark, performance, Linux, universal locale,
deployed-provider, whole-gate, superiority, or duration-completion claim is made.
