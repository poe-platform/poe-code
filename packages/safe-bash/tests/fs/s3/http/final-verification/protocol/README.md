# Independent final protocol verification

Protocol-only acceptance of Plato's endpoint-backslash and malformed-comment
fixes in `f65038e0d3e62b7fe4c05b47c1ab9d3ee364abbb`, by a leaf that authored
neither fix. Recorded August 27, 2026 UTC. Ownership is this directory only;
production, `http-independent/**`, and the service leaf's sibling directory
were read-only. No MinIO process, download, private-package access, runtime
dependency, or production edit was involved.

## Frozen acceptance and results

The accepted composition is the **complete source and actual package manifest
from `0d29f4d5e90cebc6976a51ddbeba883288126aa0`, with only `src/fs/s3/http/**`
overlaid from `f65038e0d3e62b7fe4c05b47c1ab9d3ee364abbb`**. The unchanged
`http-independent/prepare.mjs` creates each disposable source/package/consumer.
Every original review input, including evidence and fixtures, was checked
against `42056669f2373f2d34a96bce39aecb940f183ebc` before and after execution.

| Separate cohort | Original baseline | Frozen fixed composition |
| --- | --- | --- |
| Unchanged combined 129 cases: author 69, protocol 38, lifetime 22 | 125/129, exit 1 | 129/129, exit 0 |
| Five unchanged deliberately bad mutations | Not run | 5/5 detected |
| New bounded near-neighbor suite | Not run | 46/46 |
| Complete frozen production build | Pass | Pass |
| Actual packed root and HTTP subpath imports | Pass | Pass |
| Original 129 scoped strict types and independent public-consumer types | Not separately run | Pass |
| New 46-case scoped strict types | Not run | Pass |

The baseline combined run actually reproduced exactly four failing assertions:
the two original backslash endpoints and malformed comments before/after COPY
results. This is new combined 125/129 evidence, not a relabeling of the older
README's separately summed baseline cohorts. No new product bug was found in
this bounded verification. The fixes are accepted for this frozen protocol
scope, not for every intervening repository change.

Current HTTP source matched the overlay at both start and final audit. The
**full current source differed at 14 paths** (archive, SafeJS, stream-inspection,
and shell files). Each current/frozen SHA-256 is disclosed in
`evidence/2026-08-27T04-58-22-126Z/source-acceptance.json`; final observations are
in `evidence/audit-1787806822624.json`. This is not a current global build/type/test
gate, provider interoperability result, or superiority claim.

The actual package was built with the baseline's real exports, packed by
`npm pack --ignore-scripts`, and unpacked into a separate consumer. Both
`virtual-bash` and `virtual-bash/fs/s3/http` imported the same factory. Original
public-consumer declarations and the existing independent public-workflow
declarations compiled against that package; no service workflow was executed.
The manifest still has no runtime dependencies.

## New 46-case suite, not part of 129

`neighbors.test.ts` adds only nearby endpoint/XML counterexamples:

- Six accepted origin constructions: optional slash, explicit port, IPv6,
  uppercase host and percent-encoded ordinary hostname character. These are
  constructor checks without I/O, not DNS/TLS/IPv6 service acceptance.
- Ten rejected configurations: backslash authority/path boundaries, IPv6 plus
  backslash, encoded slash/backslash in authority or path, userinfo and path.
  A request-factory witness verifies no I/O on construction.
- Five literal TCP request-line witnesses for combinations of backslash,
  `@`, literal percent sequences, dot segments, repeated slashes and Unicode.
  Expected wire paths are handwritten, not calculated by the product encoder.
- Eleven valid XML cases: empty/internal-hyphen comments, comments inside and
  around scalar values, entity-looking comment contents, CDATA, ordinary
  hyphens, escaped markup and text/comment/CDATA boundaries.
- Nine invalid-comment cases: trailing hyphen, internal double hyphen and
  unterminated comment, each before/inside/after a complete result; two further
  invalid text/comment boundary cases.
- Three HTTP200 embedded Error cases preserve code, decoded message and actual
  HTTP metadata, including comments and CDATA inside scalar values.

The XML witnesses assert well-formedness and preservation of parsed scalar
values. They do not invent ETag-schema restrictions or promise arbitrary XML
processor completeness. TCP fixtures return deliberately selected responses;
they do not establish deployed-provider acceptance of these unusual keys.

## Mutations, audit correction and cleanup

The original `mutants.mjs` ran without edits. Expected failed assertions were
2/2/1/1/2 for removing the backslash guard, accepting trailing comment hyphens,
claiming conditional PUT, aliasing caller upload storage and removing GET quota.
Its `finally` restores and SHA-checks the original file after **each** mutation.
The final whole mutation source tree and untouched prepared source tree were
also independently checked against the frozen manifest.

Node 22 emits a passing **file wrapper**, not a selected test, for the other
test file when a mutation's name filter matches no tests in that file. Each
mutation capture therefore has one such wrapper plus its expected failing
tests. These wrappers are disclosed, never counted as product passes. The
unchanged full 129 and separate 46 runs have zero skips/cancellations/TODOs;
mutation captures also report zero skips/cancellations/TODOs. Name filtering
deliberately excludes unrelated tests, rather than claiming full-cohort mutant
execution. No unexpected process/test timeout, unhandled rejection or
post-test asynchronous-activity warning occurred. Expected deadline/abort
cases in the original suite remain ordinary tested behavior.

The initial verifier audit incorrectly expected selected-test counts without
Node's extra file wrapper. It rejected `3 != 2` after the original 129 tests
and all five mutations had run successfully. Its complete captures and initial
runner source remain immutable at `evidence/2026-08-27T04-57-41-896Z/`; no product
assertion or old fixture changed. Only this leaf's audit accounting changed.
The successful run is `evidence/2026-08-27T04-58-22-126Z/` (04:58:22.126 through
04:58:33.473 UTC; this is runner elapsed time, not a claim of 72 hours' work).

Successful-run temporary files were removed by the runner. `audit.mjs` then
verified full source restoration in the earlier attempt and removed only that
recorded task-owned temporary directory. Final owned `.tmp` is empty; there are
zero active owned children. All test listeners ended with their test processes.
No unrelated processes, files, staging, service data or native artifacts were
removed. Original reviewer evidence was never rewritten.

## Native curl oracle is not product curl

The older README's signing defect concerns **Apple `/usr/bin/curl` 8.7.1**,
explicitly spawned with `--aws-sigv4` by the unchanged
`tests/fs/s3/http-independent/oracle-curl-check.mjs:20`. The original on-wire
record is `tests/fs/s3/http-independent/evidence/curl-prefix-headers.json`.
The one-header control has a valid signature. With both `x-amz-copy-source` and
`x-amz-copy-source-if-match`, the native signer orders the longer name first
and its signature is invalid. This audit recomputed both preserved signatures
with the existing independent oracle and rechecked its four literal AWS vectors;
it did not rerun native curl or a service. Results and original fixture/binary/
oracle hashes are in `evidence/audit-1787806822624.json`.

Pinned curl 8.7.1 `lib/http_aws_sigv4.c`, lines 254–285, sorts whole `name:value`
strings before stripping `:` for SignedHeaders. For this prefix pair, `-` sorts
before `:`, unlike sorting header names. This accounts for the recorded native
oracle defect. No assertion is made about every curl version.

In contrast, the frozen product `src/commands/network/curl.ts:69` defines
`createCurlCommand`; its default transport is `createNodeHttpTransport` and
`src/commands/network/transport.ts:1` imports Node HTTP/HTTPS, not a native curl
process. The frozen product argument parser rejects unsupported options; this
native signing fixture did not invoke the product command. The S3 transport has
its own `src/fs/s3/http/signature.ts`. The audit records hashes of all four
relevant product files. Thus the old two SignatureDoesNotMatch rows are
**native test-oracle failures, not a demonstrated product curl bug or evidence
about provider predicate enforcement**. The older four strict MinIO guard
failures remain preserved historical provider results, not newly measured here.

## Hashes and reproduction

Profile: Node v22.22.2, Darwin 25.4.0 arm64 / Apple M5 Pro, TypeScript 5.9.3,
tsx 4.23.12, @types/node 22.20.1. Existing development tools only; no install.

| Fixed input/artifact | SHA-256 |
| --- | --- |
| HTTP transport.ts | `73611a0d279cec24d85d14031a02d92607979977ef926245fe0a6f9e7eb6161d` |
| HTTP xml.ts | `73598f1a2aedbf22a5d455849dae4f7e80f022d5ad847f136b2d1d6ecc99301e` |
| Actual package archive | `715d17a9f73be1f3c767899a2849ec58b326fd6cfabe4e073c774482ef8543e2` |
| Node binary | `5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011` |
| Frozen lockfile | `9c04bb7d2c7d1894479f0c37ce367987c2130256e5bfbf426cfa1bd2729d740b` |
| New neighbors.test.ts | `30c260a3c2ff6f0df3622951b661ebc0cc2e54eb9346bb18c9eb1d94eb15495a` |
| Successful run.mjs | `8b07c13dfd1733bd74c4887ffe2c20d7f5177ede71b85220d7b605db64ecbd5a` |

`inputs.json` hashes every original script/test/fixture/evidence input and
records Node, compiler, tool manifests, source, worktree/index and host profile.
`*-prepare-details.json` records full frozen source/author-test hashes, exact
build/pack/import/type commands and stdout/stderr. `source-acceptance.json`
also hashes every built/installed package file. `sha256.json` seals the completed
run evidence; the later audit hashes both attempts and checks all original inputs
again. All outputs have new immutable names rather than overwriting a golden.

From repository root, with the recorded development tools already installed:

```sh
node tests/fs/s3/http/final-verification/protocol/run.mjs
node --unhandled-rejections=strict tests/fs/s3/http/final-verification/protocol/audit.mjs \
  2026-08-27T04-58-22-126Z 2026-08-27T04-57-41-896Z
```

The first command creates a fresh evidence timestamp and runs the unchanged
prepare/validate/mutants scripts in task-owned temporary directories. It copies
only the new neighbor file into the frozen test tree, separately from the 129.
The second command audits the recorded run; substitute the newly printed
timestamp for a new run, and omit the optional failed-attempt argument if none.
The runner retains failed attempts for investigation instead of deleting them.
Its mutation-counter audit intentionally pins the observed Node 22 reporting
profile, so another Node reporter behavior must be reviewed, not silently passed.

## Primary references consulted

- W3C XML 1.0 Fifth Edition, sections 2.4, 2.5 (production 15) and 2.7:
  `https://www.w3.org/TR/xml/`. Comment grammar permits empty content and single
  hyphens followed by non-hyphens, but not trailing hyphen/double-hyphen content.
  CDATA/comment markers in character data must be interpreted in their context.
- WHATWG URL, special-authority/host/path parsing and forbidden-host characters:
  `https://url.spec.whatwg.org/`. Special URL parsing can treat backslash as a
  separator; origin-only rejection is this transport's explicit policy.
- AWS COPY response contract:
  `https://docs.aws.amazon.com/AmazonS3/latest/API/API_CopyObject.html`.
  HTTP200 may carry an error and the complete response must be processed.
- Pinned native curl implementation:
  `https://raw.githubusercontent.com/curl/curl/curl-8_7_1/lib/http_aws_sigv4.c`.
  The header-sort mechanism above is source inspection plus preserved wire
  evidence, not a fresh native-curl or service execution.
