# Accepted N14 source locator handoff

2026-08-29. SOURCE/DATA only; no reconstruction, decompression, extraction,
consumer evaluation, or comparison was run for this handoff.

## Identity and authoritative inputs

The accepted composition identifier is `bf079ada185a79aec864b068f3738ddc5520822e`.
It is a derived Git-tree identity, **not a promise that the tree is stored in Git**.
Do not use `bf079ada:path`, substitute HEAD, or reconstruct by checking out the
runtime source commit alone.

All paths below, unless absolute, are relative to
`tests/compatibility/bash-strict-extension-independent-20260829/n14-v2/`.

- `SOURCE.json`: 230044 bytes; raw-file SHA256
  `12a5806df9ea13eb66e99bec1f0c0c3198bfeb76da012559d943a4d874070fc4`.
  `.inputs` is the complete selected **293-file**, 2689324-byte input inventory.
  Each row binds `path`, Git `mode`, `blob`, `bytes`, and raw-content `sha256`.
  `revision` is optional: use the blob ID, not an inferred revision/path lookup.
- `.sourceCommit` is `7196bace8ea2c141d5ed1020fef5bf721c321ace`;
  `.computedTree` is the derived identity above. `.base` is
  `37e793ce6dce48a958030e7cc86fa8315d0b112e`. The resolved rows already select
  the accepted prior core and N14 runtime; do not append the provenance
  collections `.module`, `.publicRows`, or `.fixtures` to `.inputs`.
- `FINAL-MANIFEST-v2.json` SHA256
  `026c4a76cd442793276730ca83bafdfcf74e4779138e754537308fc3b8a09b39`
  binds the prior manifest through `priorManifestSha256`.
  `FINAL-MANIFEST.json` SHA256
  `c471ecf8d9582fb7fed677ef25e734b51ab8f988a9e55a2c853489016cbdcabb`
  binds the original receipts through `.files[].{path,bytes,sha256}`.

The selected `src/shell/runtime.ts` row is blob
`df6b2c0dfad8d7412f93f434d07a20b2b9375a86`, mode `100644`, 203623 bytes,
SHA256 `4e67e4e5d1d4a0c6b9b479d4381edbab5948a7b2b292f219a46067aeee7ce058`.
The parser and conditional rows have no `revision` field; their authoritative
blob IDs are respectively `27bcacc6c9a731ff02c6ef3700e96a7a1f8e4ebe` and
`caab6172df5b8e5bad2d1db007b156f067e295ad`.

## Reconstruction recipe for future authorized execution

1. Admit the exact regular-file metadata and raw hashes of the manifests and
   source inventory before parsing them. Validate unique safe relative input
   paths and regular Git modes `100644`/`100755`.
2. Request each **individual `.inputs[].blob`** using `git cat-file --batch`.
   Require the exact OID, `blob` type, declared length, payload and delimiter;
   verify raw SHA256 and Git SHA1 of `blob <length>\0` followed by the payload.
   Only then write the admitted bytes into a fresh bounded regular-file tree.
   This handoff checked availability/type/size for all 293 stored blob objects;
   it did not retrieve or freshly hash their payloads.
3. `SOURCE-TREES.json` (14655 bytes, SHA256
   `90a458bb23ba83fb13ae4057a905306997ec650e7244f91b3c9acc44a1e17274`)
   supplies `.fetched` tree metadata. Existing `admission.mjs` documents the
   composition proof using this and SOURCE's ancestor/reconstructed metadata.
   A tree body hashes as Git SHA1 of `tree <length>\0` plus its body; entries are
   mode/name/NUL/raw-OID records, ordered bytewise with `/` appended for directory
   comparison. Authenticate every path's mode/OID from the derived root.
   The derived tree is not a flat hash of the 293 selected files, nor the
   SOURCE.json SHA256. Sparse witnesses alone are not complete inventories.
   Historical instruction-file entries remain opaque metadata: never fetch or
   materialize their plaintext bodies to reconstruct the selected input set.
4. Independently admit the compiler/dependency closure and any new consumer
   before execution. No historical consumer receipt authorizes Faraday's new
   comparison script automatically.

## Tools, shipping bytes and load bindings

`TOOLS.json` SHA256 is
`0a6f49ac1f57c229cfdb14d92cf6bd3a69ca64791f58d61ff3f472bb8df0e95e`.
Its `.tools[name].originalRows` and SOURCE's `.toolBindings` bind TypeScript
5.9.3, @types/node 22.20.1, undici-types 6.21.0 and npm 10.9.7.
The inventory hash domain is **UTF-8 `JSON.stringify(originalRows)` without a
newline, preserving recorded order**, not a newly sorted traversal. All four
recorded domains were independently recomputed from authenticated DATA here;
`HASH-DOMAINS.json` records the results. Current tool-file bytes still require
fresh admission. Node's recorded v22.22.2 executable is
`/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node`, SHA256
`5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011`;
the binary was not freshly hashed in this handoff.

`actual-v2/evidence/RESULT.json` (SHA256
`c031715228f24c4bd48a231a87668f153ff7cf1ee2882fde7ac90ed372267a3a`)
has `.package.members`: **954** package-relative shipping rows with decimal
mode, bytes and raw SHA256. `.package.sha256` authenticates compressed package
bytes, not a JSON serialization of those rows.
`actual-v2/evidence/source-strict-binding.json` and
`actual-v2/evidence/moved-strict-binding.json` have `.root`, `.inputs`, `.harness`
and `.trace`; their 952 source/dist load inputs are not the 954 shipping rows.
`actual-v2/evidence/source-strict-loads.jsonl` records the historical load trace.
`EXECUTOR-v2.json` binds the old executor files and source identity. Exact
regular-file sizes/hashes for these receipts are in `LOCATORS.json`.

The retained compressed package exists at:

`/private/tmp/strict-n14-independent-active-1AKd2V/strict-extension-independent-iRrorS/virtual-bash-0.0.0.tgz`

It was freshly checked as a regular **872281-byte** file and stream-hashed to
`3f3ae85116f12ab4354a6103c0c95e967c4e88bd2eb133e63236148a2734af49`.
The adjacent `source` directory exists but was not recursively reauthenticated.
The historical moved-package locator is the adjacent
`moved package/node_modules/virtual-bash`; its whole tree was not freshly checked.
Do not treat retained-directory existence as executable admission.

## Correct early compressed admission

Use the existing, separately qualified
`prospective-admission-v1/package-admission.mjs` export `admitPackage` with
authority `{bytes:872281, sha256:"3f3ae85116f12ab4354a6103c0c95e967c4e88bd2eb133e63236148a2734af49"}`.
Its `EVIDENCE-MANIFEST.json` SHA256 is
`320bab5fc4e62a9f57e475e89be6075f6ede828e84803631e173355a8317a418`.
The helper, `parse-manifest.mjs` and `EXPECTED-MEMBERS.json` were authenticated
against that manifest; see `LOCATORS.json` for their exact file identities.

The gate requires regular-file/exact-size checks before bounded read, descriptor
identity checks, and expected compressed SHA256 **before any decoder/parser**.
Decode the same authenticated Buffer, not a reread pathname. Retain the 872281B
compressed ceiling, 64MiB decoded ceiling and concurrent-buffer ledger charges;
bind the decoder/parser and compare all 954 expected members. These are logical
bounds, not hostile-host race-proof security or RSS guarantees. No decoder,
parser or helper was invoked here; no encoded DATA archive is needed to locate
or reconstruct the 293 source inputs.

## Qualifications and preserved records

Root acceptance `76648c572b26486c02e45c65ad42dd74bc938e15` records finite
source/semantic acceptance based on be7d4b98, c6992dfa and aede1639. The old
campaign remains CLOSED/noncompliant for pre-inflate admission ordering: its
744 literal results are not rescored. Do not reuse old `run-v2.mjs`'s ordering.
Future coherent execution must apply the corrected admission contemporaneously.

This handoff itself mistakenly requested the nonexistent historical path
`actual-v2/evidence/BINDING-PROOF.json`. The captured ENOENT is preserved in
`capture/final-inspection.stderr.raw`; this was a guessed-locator instruction
violation, not a product failure. Subsequent locators came from authenticated
inventory entries. No absent artifact was invented, decoded or recreated.
The source/DATA collectors retired naturally; this task makes no new product,
comparison, native-parity, whole-tree or acceptance claim.
