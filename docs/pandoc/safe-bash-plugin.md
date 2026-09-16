# Explicit Pandoc safe-bash plugin

The command is an explicit plugin over `@poe-code/pandoc`; it is absent from
`agentCommands`. The public route is `poe-code/safe-bash/commands/pandoc` and
provides `createPandocCommand`, `createPandocCommands`, `pandocCommands` and
`PandocCommandsOptions`. Plugin options are lowerable SDK `limits` and boolean
`replace`; no environment variables are exposed. Collision preflight precedes
registration; replacement affects only `pandoc`.

```ts
import {pandocCommands} from "poe-code/safe-bash/commands/pandoc";
shell.use(pandocCommands({limits: {inputBytes: 1_048_576}}));
const result = await shell.exec("pandoc -f commonmark -t html5 'input file.md' -o output.html");
```

Literal retained argv must be valid UTF-8 without NUL. `--` permits option-looking
filenames, including `--help`. Files and the single permitted `-` operand preserve
argv order; repeated stdin operands are usage errors before acquisition. No
operands selects stdin; an implicit default stdin does not acquire a replacement
stream. Text decoding and RTF codepage decoding belong to the SDK: RTF bytes stay
raw until its own decoder. PDF and EPUB use raw `Uint8Array` stdout/file payloads;
`-o -` selects stdout. Information modes and invalid usage do not read inputs or
open command destinations.

PDF options map to typed `pdf` page size, orientation, margin, font, font size and
line height. Only the verified bundled mono font is available; serif/sans requests
return `E_CAPABILITY`. Explicit supplied font paths resolve through the VFS;
ambient fonts and external PDF engines are forbidden. EPUB options map to typed
`epub` title, language, identifier and chapter level. EPUB defaults require the
typed `yes` option / CLI `--yes`; otherwise required metadata must be present.
Declared resource search/extraction uses the same VFS and SDK admission policy.
Unlisted style/resource flags never enable native capabilities.

Command `-o` serializes and validates before publication. It requires the
destination provider's `atomicFileMutation` and conditional-write operation;
providers lacking them return `E_CAPABILITY` before input reads. The atomicity
claim applies only to that declared conditional publication, not resource
extraction or a sequence of filesystem operations. Existing destination
symlinks/nonfiles are refused. Input, metadata, font and redirected-stdin aliases
are rejected using filesystem identity/comparison; unknown existing identity is
a safe refusal. Identity comparison is not a lease or defense against every
concurrent alias race.

Shell `>` is separate: the shell may open/truncate its destination **before the
command executes**, even when command usage then fails. The command also refuses
known/unknown conflicts for redirected output, but cannot restore earlier shell
effects. Downstream stdout failures can leave previously delivered bytes and
offer no rollback. Resource extraction writes likewise have the SDK's weaker
nontransactional semantics. Cooperative reads/writes are enrolled before
acquisition and drained on cleanup; cancellation cannot undo completed effects.

Original tests first reproduced missing plugin/inference/information APIs,
redirected stdin and redirected stdout alias gaps, then passed after fixes.
New mutations use memfs, with no host scratch, downloaded fixtures, LLMs or
external executables in owned unit tests. Independent review added cancellation,
budget, byte-argv, identity, warning and FS-error coverage. The
[compiled CLI screenshot](safe-bash-plugin.png) was visually inspected.

Verified: 932 Pandoc tests, 47 PDF tests, 24 actual Shell adapter tests;
Pandoc/PDF package lint and source/test typechecks; selected maintained
virtual-bash build closure; 532 maintained build/runner tests; maintained strict
safe-bash source/tests and all 26 current consumer groups, including required
negative consumers; 31 root bundling/package-metadata controls; full maintained
root build. Public bundled-import QA verified PDF/EPUB stdout against command
`-o` bytes and refreshed the inspected screenshot. A failing original consumer
closure test reproduced an SDK-wrapped EPIPE becoming an internal error;
preserving the owned stdout signal reason fixes both acquisition and write paths.
Independent review confirmed the narrow fix. Bundling tests reproduced missing
CommonJS resolution inside the ESM PDF dependency; the explicit Node bundle now
provides `createRequire`, and the public import/conversion QA passes.

Package lint passes 16 of 17 rules, including shipped dependency resolution and
bundle self-containment. Its remaining violations are missing
`packages/pandoc/README.md` and `packages/pdf/README.md`. Root instructions prohibit
README additions without user permission; no READMEs were added. Full repository
tests reported a missing unrelated design-system fixture
`docs/plans/archive/cli-aliasing.md`; that fixture remains outside this task.
Guarded repository ESLint completed successfully with zero errors and 14 warnings;
the temporary lint log was purged. The full repository test run reported failures
and continued running for over 24 minutes; its owned shared-Vitest process was
then stopped (exit 143). It did not complete and is not claimed as passing.
The root export expectation reported in that earlier run was corrected and its
maintained targeted controls subsequently passed. No push, remote-main delivery
or release was performed.
