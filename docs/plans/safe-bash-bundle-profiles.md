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
| core | 4,949,332 | 0 |
| rootCore | 4,954,469 | 5,137 |
| pythonLlm | 5,046,947 | 97,615 |
| pdf | 5,942,440 | 993,108 |
| multiplePdf | 6,018,154 | 1,068,822 |
| csv | 6,656,262 | 1,706,930 |
| csvXlsx | 6,852,858 | 1,903,526 |
| git | 10,269,735 | 5,320,403 |
| defaultRegistry | 6,212,163 | 1,262,831 |
| registryWithRegex | 6,213,504 | 1,264,164 |
| full | 24,851,519 | 19,902,187 |
| rootPythonLlm | 5,052,096 | 102,764 |
| splitCore | 4,871,225 | -78,107 |
| splitPythonLlm | 4,968,430 | 19,098 |
| splitFull | 24,702,427 | 19,753,095 |

The Worker checks pipeline streaming, canonical filesystem writes, abort-reason identity, selected PDF inspection, CSV/XLSX conversion and Git initialization/status. Python execution and LLM responses use injected test hosts, without model requests. Installed type fixtures verify shell/full identity and selected command contracts; existing Node/Bun publication fixtures cover normal import behavior.

## Git asset audit

The historical Git Wasm grew from 2,878,331 to 5,310,726 bytes. Changes between the containing source revisions include signing (Ed25519/OpenSSH SSHSIG/OpenPGP), hooks/core.hooksPath, SSH transport and known_hosts, server hooks, standalone native host filesystem and credentials, upload-pack/receive-pack and SSH-to-HTTPS fallback. The packaging script selects the `git_rust.wasm` library artifact, not the separate `git-rust` executable. Native host filesystem/process/credential-helper adapters live in `src/main.rs`; their presence in the source diff is not evidence that those adapters caused library Wasm growth. The library includes portable crypto, hooks, SSH and wire modules. These are supported features, not demonstrated duplicate copies. This change preserves them. Core and unrelated profiles must carry zero Git assets; the selected Git profile must carry exactly one Wasm and execute repository initialization/status. The current packed asset is 5,310,842 bytes, with one copy in Git/full and zero in unrelated profiles. Native-only code splitting would need a separate behavior-qualified compiler change.

## Production qualification

Use an isolated, hash-verified snapshot of the real consumer's tracked and untracked integration edits. Preserve enabled commands, document/media/Git capabilities, filesystem limits, Python and LLM integration, and the intentional disabled command set. Run its maintained `bun scripts/deploy.ts --gate-dry-run <output>` route, with no deployment. Count upload modules rather than debug maps. The unchanged exact-pin consumer baseline reproduces 57,607.00 KiB uncompressed; compare the containing public version using the same source and minification setting.

Publication and production qualification remain required after source, packed-package and local checks pass. Store temporary output outside this document and remove it after reporting verification.
