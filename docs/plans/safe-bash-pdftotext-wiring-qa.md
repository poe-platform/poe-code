# pdftotext command wiring QA

Scope: opt-in invocation admission and packaging only. Extraction acceptance is
blocked by the absent PDF security/font/CMap/ActualText/layout engine. This
increment does not satisfy the full command task or advertise Poppler parity.
The package-pattern document is available at
[its existing archived location](archive/safe-bash-command-package-pattern.md).
No existing plan status or research receipt was changed.

## Execute

1. Run `npm run test:unit --workspace=safe-bash-command-pdftotext` and
   `npm run lint --workspace=safe-bash-command-pdftotext`.
2. Run `node --import tsx --test packages/safe-bash/tests/plugins/pdftotext-wiring.test.ts`.
   Exercise opt-in registration, SDK equivalence, literal `--` paths, VFS
   script/pipeline output, unchanged binary input/output and forbidden network.
3. Run the maintained guarded closure:
   `npm run build:workspaces -- --workspace=@poe-platform/safe-bash`.
4. Stage public libraries with `scripts/package-safe.mjs --out-dir <evidence-directory> --version <candidate-version>`.
   Pack the three public libraries with scripts disabled. Install them offline
   with scripts disabled into a fresh consumer outside the checkout. Do not
   install any private workspace.
5. Copy and run `scripts/fixtures/safe-packages-pdftotext.mjs` in that consumer.
   Typecheck `safe-packages-pdftotext-types.mts` with strict NodeNext,
   exact optional properties and unchecked indexed access.
6. Remove task-owned tarballs, staged libraries, consumer and logs. `/out` is
   read-only on this host; use workspace `out/pdftotext-wiring` temporarily.

## Observed on 2026-09-21

- Red tests preceded the command implementation. Separate failing tests exposed
  output-only SDK operand confusion and mutation of nested SDK options; both
  passed after their implementation repairs.
- 29 package tests passed, with no skips. Package ESLint and source/test
  typechecks passed. Two memory-VFS shell integration tests passed.
- Guarded selected safe-bash workspace build closure passed. Private command
  admission uses its explicit version/dependency profile; safe-bash only
  re-exports the implementation. Default registration is unchanged.
- Isolated installed runtime fixture and strict NodeNext declaration consumer
  passed for local candidate `0.0.0-pdftotext-wiring`, without private packages.
- Invocation cleanup is registered before output acquisition, cancellation
  interrupts output, and cleanup drains an acquired owned write. Arguments and
  output are bounded. No input is acquired in this admission-only increment.

Extraction requests return 99 with an explicit unavailable-engine diagnostic,
not a fabricated PDF-open/output-open/permission result. Quiet suppresses this
initialized diagnostic; invalid EOL remains direct. The listed four encodings
are admitted first-party primitives, not Poppler's complete native encoding
registry. UTF-8 CLI passwords retain the exact 32-byte truncation profile; raw
SDK passwords remain unavailable. No extraction permission profile is selected
or advertised. No PDF mapping/layout/metadata/security/replay fidelity is claimed.
Full repository tests, visual screenshots, actual browser/workerd engines and
native extraction controls were not run for this increment.

Local commits: none. Verified remote-main delivery: none. Successful release:
none. No private package publication was attempted.

## Shared-parser candidate follow-up, 2026-09-21

Execute the package and shell checks above, then additionally call the public
parser on `input.pdf -qr -h`, attached/equals options and GNU abbreviations.
Require explicit unknown-option failures. Admit those same tokens as literal
paths after `--`, and admit `./-qr`, `/-qr` and stdin `-` directly. Check that
`-upw -unknown -h` consumes the password operand literally and agrees with SDK
`userPassword: '-unknown'`. Check `-q input.pdf -qr -h` prints the early error
with status 99. Inspect a terminal screenshot of help, this early error and
quiet invalid EOL. Repeat these parser negative controls in the installed
consumer, alongside the runtime and strict declaration fixtures above.

The new public-parser regression failed before implementation with a missing
expected unknown-option exception. Unknown-option checking now lives in the
shared parser; the duplicate CLI scan was removed. CLI, SDK and the public
parser use the same admission policy, with SDK literal filenames serialized
after `--`. No extraction implementation or default registration changed.

Fresh results for this candidate:

- 32 private-package tests passed; zero failures or skips. Package ESLint and
  source/test typechecks passed. Both memory-VFS shell wiring tests passed.
- The maintained selected safe-bash workspace build closure passed using the
  default shared cache. All three private bundle recipe tests passed under
  `npx vitest run --config vitest.root.config.ts scripts/bundle-safe-bash-private.test.ts`.
- An initial attempt to run that Vitest file with Node's test runner failed
  because no Vitest suite existed. Correcting the runner resolved the failure;
  no source or test assertion was weakened.
- Staged public artifacts were packed with scripts disabled and installed
  offline, with scripts disabled and legacy peer resolution, into a fresh
  consumer outside the checkout. Runtime fixture, strict NodeNext declaration
  fixture and independent installed parser negative controls passed without
  private workspace installation. Local candidate version:
  `0.0.0-pdftotext-candidate`. Safe-bash tarball SHA256:
  `d252bfa70e206b5a814cfc1d1450dccd2041da44af895f33cf6e77f6cb10c33b`.
- The maintained `npm run screenshot --` renderer captured actual memory-VFS
  Shell invocations for help, quiet unknown options and quiet invalid EOL.
  The image was inspected: text was legible and complete, with statuses 0,
  99 and 0 respectively. The root poe-code CLI has no pdftotext registration;
  the screenshot targets the opt-in Shell command directly.

`/out` creation failed because the host root filesystem is read-only. Temporary
evidence used workspace `out/pdftotext-candidate-20260921`; staged packages,
tarballs, screenshot and the external consumer were removed after inspection.
Repository-wide test/lint/build gates were not run for this focused parser
change. Browser/workerd/Bun execution, native extraction compatibility cells,
original/checkpoint/replay extraction, raw SDK passwords, permission profiles
and extraction resource/effect controls remain unverified or unsupported.
No focused run is represented as a broad-gate pass. No local commit, verified
remote-main delivery, release or private publication occurred.
