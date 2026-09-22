# Current csvcut wiring verification

Scope: inspect the existing private command, CLI/SDK and qualified bundled export;
repair only independently reproduced wiring defects. Preserve unrelated edits.
Selected compatibility release: csvkit 2.2.0. The archived package pattern at
`docs/plans/archive/safe-bash-command-package-pattern.md` is authoritative here.

## Manual steps

1. Run the command workspace's maintained unit and lint routes. Verify literal
   expected outputs, cancellation, producer ownership, cleanup, input/output
   budgets, grammar and unknown/source-only flags. For repeated quoting options,
   `-u1 --quoting=0` and `--quoting=2 -u0` must match SDK mode 0. Reverse order
   must reject the final unsupported mode before acquiring input. Malformed
   integer grammar must still fail rather than being overwritten.
2. Run the memory-VFS Shell wiring controls for opt-in registration, collisions,
   replacement, pipelines, redirects, invalid byte argv and forbidden network.
3. Build the explicitly selected `@poe-platform/safe-bash` closure using the
   maintained build route with `--no-cache`. Stage public artifacts with
   `scripts/package-safe.mjs`. Pack and install only public SafeFS/SafeJS/SafeBash
   tarballs offline, without lifecycle scripts, into a consumer outside the repo.
4. Run the maintained installed private-command fixture and strict csvcut
   NodeNext type consumer. Independently execute repeated quoting positive and
   negative controls against the installed export. Confirm private packages are
   absent. Run browser/workerd export-condition graphs in a Node VM without
   Buffer/process/require, labeling these as conditional graph evidence only.
5. Capture and visually inspect installed help, names, projection and a final
   unsupported quoting diagnostic using the maintained screenshot renderer.

## Limits and evidence handling

No shared infrastructure or workflow changes are part of this increment. Use
focused maintained routes; do not infer fresh broad-gate completion from earlier
receipts. Native csvkit execution is manual-only and unavailable in this session;
Python argparse observations are grammar evidence, not a pinned csvkit oracle.
Actual browser/workerd/Bun, checkpoint/replay and complete Python reader/Sniffer,
encoding, quoting and error compatibility require separate qualification.

Absolute `/out` is read-only on this host (mkdir fails). Temporary logs, staged
artifacts and screenshots therefore use ignored `out/csvcut-final-verification`,
with an external temporary installed consumer. Purge task-owned output after
recording results. No publishing, push or release is requested.

## Execution receipt

Executed on 2026-09-20 against base HEAD
`ab1fa8d34101e1e7f61272973f3bc28a842043d8` plus the existing working tree and this
focused repair. Source SHA256:

- `src/command.ts`: `d25753c55f6a3589c3231c8478fd0aeabc8e6a0f9e3cad8ef979a2d81108b8c2`.
- `src/command.test.ts`: `76c434bf2390423e6c5281a08f16fde2a5cc7c3805152b3e81430fb3b331ac92`.

The baseline had 94 passing command controls. The new literal quoting-order
control failed with status 1 instead of 0 for `-u1 --quoting=0`. Grammar now
collects the last syntactically valid quoting value before checking capability;
final modes 1/2 still fail before input acquisition. Malformed integer values
still fail immediately. Python argparse independently returned final quoting 0
for this option order; it was not used by unit tests or counted as native csvkit
compatibility evidence.

Passes:

- Maintained `npm run test:unit --workspace=safe-bash-command-csvcut`: 95 passed,
  zero failures/skips/cancellations. Includes final added malformed-value controls.
- `npm run lint --workspace=safe-bash-command-csvcut`: ESLint plus production
  and test TypeScript checks passed.
- Both memory-VFS `csvcut-wiring.test.ts` Shell controls passed.
- `npm run build:workspaces -- --workspace=@poe-platform/safe-bash --no-cache`:
  complete maintained selected build closure passed, including guarded Safe Bash
  inputs/build and its native postbuild.
- Maintained public artifact staging passed. Three public tarballs at
  `0.0.0-csvcut-current` installed offline with scripts disabled into a fresh
  consumer outside the checkout. Private command/contracts/CSV-engine packages
  were absent. Maintained installed private-command runtime fixture and strict
  NodeNext csvcut declaration consumer passed.
- Installed independent controls passed for both overwritten unsupported quoting
  modes, final unsupported quoting, overwritten malformed integer and rejection
  of source-only `--ignore-unknown-columns`.
- Maintained publication-boundary fixture bundled under browser and workerd
  conditions and passed in Node VM realms without Buffer/process/require. These
  are conditional graph checks, not actual browser/workerd runtime qualification.
- Maintained screenshot renderer captured installed help, width-three names,
  repeated-quoting projection and final unsupported-mode stderr/status. Visually
  inspected: readable text, aligned names and correct output/status.
- `git diff --check` passed.

Resolved failures: the initial reproduction above failed as required by TDD.
An initial selected-build invocation used the incorrect literal workspace
`@poe-code/safe-bash` and was rejected before building; the corrected maintained
route completed. No test assertions or timeouts were weakened.

Unsupported: codecs beyond admitted UTF-8-sig aliases, quoting 1/2, native
character field-size limits, Sniffer and full Python-version reader/error/NUL
parity retain the existing documented limitations. Unknown/source-only flags
remain explicit usage failures. Full csvkit compatibility is not claimed.

Unverified/skipped execution cells: native pinned csvkit/Python 3.9 oracle,
actual browser/workerd/Bun (Bun unavailable), full checkpoint/replay and bounded
performance measurements. No generated-case search was run; no seeds are
claimed. Repository-wide `npm test`, lint and root build were not rerun for this
command-local change; previous broad receipts do not qualify this candidate.
No started verification run remains incomplete.

Tarball SHA256:

- Safe Bash: `2831a59bc2ecad90a55d4bc3d3b131c6754b7359f862eb7753fbdcd749e5e3ec`.
- SafeFS: `ca46d67974028d22c9b938184fd963e1ccae9fe14d37045ff630857e3d686959`.
- SafeJS: `30098d9470e31e5983338221f33725722401a4e4c44d0d779d0ac3e6e641d278`.

Local commits: none. Verified remote-main delivery: none. Successful releases:
none. No command publication occurred. Task-owned logs, tarballs, staged files,
screenshots and the external installed consumer were purged after this receipt.
