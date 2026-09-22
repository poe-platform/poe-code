# PDF parser API candidate validation

Status: private contracts verified locally; full consumer acceptance and mature
parsing remain incomplete. No command capability was promoted.

Candidate base: `ab1fa8d34101e1e7f61272973f3bc28a842043d8` plus the existing
working tree. Parser closure SHA-256:
`355f49cf9067859607aefabf960611c002db92cdf6eb7b9a56eb60dfba025432`.
The digest covers sorted package-relative paths for package.json, both
tsconfigs, README.md, LICENSE and every src/*.ts file, hashing each UTF-8 path,
NUL, decimal byte length, NUL and file bytes. It identifies the inspected parser,
not the separate Safe Bash artifact or the entire working tree.

## Executed verification

- `npm run test --workspace=pdf-parser`: 164 passed, zero failures,
  cancellations, skips or todos. Includes conditional source bundles executed
  in isolated Node VM realms; these are not actual browser/workerd runtime cells.
- `npm run lint --workspace=pdf-parser`: ESLint and both source/test
  typechecks passed.
- `npm run build:workspaces -- --workspace=pdf-parser`: maintained selected
  workspace build passed, emitting runtime files, declarations and license.
- `npm run lint:packages`: all 18 rules passed across 95 packages.
- Direct emitted Node ESM consumer: byte-preserving hex string parsing, blocked
  qpdf gate and empty declared runtime dependency graph passed.
- Emitted declaration consumers: NodeNext/node and Bundler/browser/workerd
  conditions passed with strict typing, exact optional properties, unchecked
  indexed access and ES2022/DOM libraries, without ambient Node type packages.
  The in-memory consumer covered parse, object/document access, page inventory,
  stream decoding, standalone/document text and layout, and command gates.
  Expected-error controls rejected file paths as parser input, a caller-supplied
  qualification override, mutation of a gate and an unsupported command name.
  No consumer fixture file was created. These compile cells establish declaration
  usability, not corresponding runtime acceptance.
- `git diff --check`: passed before this receipt was added.

No code defect was validated in this inspection, and existing implementations
were preserved. No upstream code or data was copied, external parser adopted,
native oracle invoked or runtime dependency added. Repository-wide build/test/
lint and CLI screenshots were not run: this inspection changes documentation
only and changes no visible CLI behavior. There was no failed or incomplete
focused check.

## Acceptance still required

The README already documents byte ownership, interfaces, limits, errors,
recovery and the frozen capability matrix. All dependent command profiles remain
blocked; qpdf additionally requires lossless rewriting. The existing pdftotext
command is an admission-only profile and cannot count as extraction integration.

Parser-consuming installed Safe Bash artifacts have not been admitted or
verified. Required first-party parser source and licenses must be bundled through
the maintained private command boundary when a qualified consumer is added;
ambient private-package imports are not an acceptable substitute. Follow the
existing moved pattern at
`docs/plans/archive/safe-bash-command-package-pattern.md`.

Actual browser/workerd execution, installed Safe Bash runtime/declaration
consumers, replay/host-authority controls for those integrations, filtered index
integration, encrypted document interpretation, mature font/text/layout
qualification and lossless rewriting remain unverified or unsupported, as
recorded in `pdf-parser-api-contracts.md`, `pdf-parser-api-review.md` and
`pdf-parser-qualification.md`. Header acceptance and pinned upstream research
do not close those feature gates. This receipt does not mark the mature-parser
task complete.

Local commits: none. Verified remote-main delivery: none. Successful releases:
none. No push was requested or performed.
