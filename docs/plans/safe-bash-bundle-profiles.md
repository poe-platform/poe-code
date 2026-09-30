# Safe Bash installed bundle profiles

Keep default command behavior and an explicit `/full` aggregate. Applications compose an empty `Shell` and `CommandRegistry` from `/shell` with selected command plugins. Existing root named imports must also eliminate unused optional engines under ordinary ESM bundling.

## Packaging decisions

Enter private commands through their original source graph instead of feeding independently bundled workspace outputs into a second bundle. Preserve explicitly prebuilt transformations such as Pandoc's Lua runtime. Make the PDF AST workspace a canonical package owner shared by command subpaths and the public SDK.

Separate synchronous CSV lexical/helpers from CLI descriptor barrels, and move generic ZIP handling to the office package. Optional command adapters register synchronous evaluators when their factories are selected. Only reviewed private command facades are declared free of import-time effects; retain Buffer installation, native loaders and vendored PDFJS iterator initialization. Transfer the source facade policy to generated chunks using their actual initializer contributions; give Buffer its own entry so its effect does not retain unrelated commands.

A seven-PDF-command minified source recipe measured 7,160,948 bytes before graph deduplication and 1,355,630 afterward. This measurement identifies repeated embedded engines, rather than assuming every new dependency byte is waste. Installed acceptance also detected two decoder copies when command plugins and the PDF SDK were combined.

## Maintained acceptance

Run `npm run verify:safe-bash-profiles -- <installed-consumer-directory>` against installed tarballs or exact public versions. The scoped release workflow runs it before publication. It bundles without checkout aliases or exclusions, totals every emitted static JavaScript/Wasm/data module, reports deltas against core, asserts excluded engines, and boots each profile in Miniflare/workerd. Profiles cover both shell and root core imports, Python with LLM, one PDF, several PDF commands plus SDK, CSV, CSV/XLSX, selected Git, and the full export surface.

Default ESM profiles use esbuild's normal unsplit output. Additional shell, Python/LLM and full profiles enable code splitting and count every generated chunk. Esbuild emits orphan dynamic-import chunks from unused aggregate exports when splitting is enabled; use `/shell` and explicit command paths for that configuration. Root named shell/Python/LLM/default-registry/regex bindings also get separate facade ownership.

Budgets are derived from the measured installed tarballs below: 2% total growth, plus 5% growth of each incremental delta with a 16 KiB minimum allowance. They are regression budgets, separate from Cloudflare's deployment limit.

| Profile | Static bytes | Delta from core |
| --- | ---: | ---: |
| core | 4,511,475 | 0 |
| rootCore | 4,518,173 | 6,698 |
| pythonLlm | 4,773,428 | 261,953 |
| pdf | 5,584,820 | 1,073,345 |
| multiplePdf | 5,662,677 | 1,151,202 |
| csv | 6,217,430 | 1,705,955 |
| csvXlsx | 6,451,765 | 1,940,290 |
| git | 9,866,010 | 5,354,535 |
| baseRegistry | 6,014,924 | 1,503,449 |
| registryWithRegex | 6,014,961 | 1,503,486 |
| enabledConsumer | 6,079,876 | 1,568,401 |
| full | 25,001,199 | 20,489,724 |
| rootPythonLlm | 4,780,517 | 269,042 |
| splitCore | 4,434,552 | -76,923 |
| splitPythonLlm | 4,695,775 | 184,300 |
| splitEnabledConsumer | 5,995,120 | 1,483,645 |
| splitFull | 24,845,451 | 20,333,976 |

The Python/LLM baselines additionally include the integrated template store, template YAML handling, extraction ranges, key aliases, and Python LLM capability/module changes since `c7d1b86e90`. These profiles grew by 30,386–30,900 bytes in total (25,823 bytes incremental for Python/LLM after core growth). The installed graph retains the selected Python and LLM modules; unrelated profiles remain within their previous budgets. The root facade regression was fixed independently: command bootstrap declarations no longer force every command chunk into root imports, reducing measured root overhead from 92,347 to 6,708 bytes without changing its budget. Only the three Python/LLM baselines were updated; growth tolerances and runtime/engine assertions remain unchanged.

The Worker checks pipeline streaming, canonical filesystem writes, abort-reason identity, selected PDF inspection, CSV/XLSX conversion and Git initialization/status. Python execution and LLM responses use injected test hosts, without model requests. Installed type fixtures verify shell/full identity and selected command contracts; existing Node/Bun publication fixtures cover normal import behavior.

## Git asset audit

The historical Git Wasm grew from 2,878,331 to 5,310,726 bytes. Changes between the containing source revisions include signing (Ed25519/OpenSSH SSHSIG/OpenPGP), hooks/core.hooksPath, SSH transport and known_hosts, server hooks, standalone native host filesystem and credentials, upload-pack/receive-pack and SSH-to-HTTPS fallback. The packaging script selects the `git_rust.wasm` library artifact, not the separate `git-rust` executable. Native host filesystem/process/credential-helper adapters live in `src/main.rs`; their presence in the source diff is not evidence that those adapters caused library Wasm growth. The library includes portable crypto, hooks, SSH and wire modules. These are supported features, not demonstrated duplicate copies. This change preserves them. Core and unrelated profiles must carry zero Git assets; the selected Git profile must carry exactly one Wasm and execute repository initialization/status. The initial packed asset was 5,338,726 bytes; after integrating upstream Git changes, the verified packed asset is 5,338,654 bytes, with one copy in Git/full and zero in unrelated profiles. Native-only code splitting would need a separate behavior-qualified compiler change.

## Consumer composition

`agentCommands()` retains its GH-enabled default; `baseAgentCommands()` selects
the shell registry without GH/Git and accepts the same family limits. Add the
explicit GH plugin wherever the application enables it. The split consumer baseline was measured against a 4,949,378-byte core.
The maintained `enabledConsumer` profile preserves the independently captured 121-command application inventory. Use named `baseAgentCommands` and `createBoundedRegexProvider` imports from `/registry` alongside `Shell` from `/shell`. Add these explicit plugin imports, retaining the application's existing per-family resource options:

```ts
import { Shell } from "@poe-platform/safe-bash/shell";
import { baseAgentCommands, createBoundedRegexProvider } from "@poe-platform/safe-bash/registry";
import { bcCommands } from "@poe-platform/safe-bash/commands/bc";
import { csvcutCommands } from "@poe-platform/safe-bash/commands/csvcut";
import { csvgrepCommands } from "@poe-platform/safe-bash/commands/csvgrep";
import { diff3Commands } from "@poe-platform/safe-bash/commands/diff3";
import { fdCommands } from "@poe-platform/safe-bash/commands/fd";
import { htmlqCommands } from "@poe-platform/safe-bash/commands/htmlq";
import { lessCommands } from "@poe-platform/safe-bash/commands/less";
import { unrtfCommands } from "@poe-platform/safe-bash/commands/unrtf";
import { yqCommands } from "@poe-platform/safe-bash/commands/yq";
import { ddCommands } from "@poe-platform/safe-bash/dd";
import { yesCommands } from "@poe-platform/safe-bash/yes";
```

Compose these plugins through `shell.use()` or their public `setup(host)` contract, as the application's existing plugin does. Preserve its configured regex provider, filesystem limits and command limits rather than replacing them with example defaults. The installed acceptance checks the complete enabled inventory after initialization, streaming, VFS writes and cancellation.

This explicit registry entry also avoids the root aggregate’s unused dynamic
chunks when ESM splitting is enabled. This composition does not import the `op`, `node` or `safejs` plugins; the installed output explicitly rejects the secrets engine's runtime marker as well as unused document/media/Git engines. Preserve the existing policy removing `ln` and `readlink` after plugin setup. Those two commands belong to the shared filesystem family; registration policy does not prove their shared implementation bytes disappear. No bundler aliases, consumer source rewrites or exclusion plugins are required. Additional document/media/Git plugins remain explicit opt-ins and must be retained wherever the application enables them.

## Production qualification

Use an isolated, hash-verified snapshot of the real consumer's tracked and untracked integration edits. Preserve enabled commands, document/media/Git capabilities, filesystem limits, Python and LLM integration, and the intentional disabled command set. Run its maintained `bun scripts/deploy.ts --gate-dry-run <output>` route, with no deployment. Count upload modules rather than debug maps. The unchanged exact-pin consumer baseline reproduces 57,607.00 KiB uncompressed; compare the containing public version using the same source and minification setting.

Publication and production qualification remain required after source, packed-package and local checks pass. Store temporary output outside this document and remove it after reporting verification.
