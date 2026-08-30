# Default build configuration alignment

## Result

**Normal build configuration no-emit check PASS.** `tsconfig.build.json` now adds only the exact 16 inventoried experimental production TypeScript exclusions. The previous tests/dist/node_modules exclusions, all compiler options, accepted source files, package script, and public exports are unchanged. No production source implementation was edited.

TypeScript 5.9's own configuration resolver compares the old and new normal-project inputs: the exact delta is those 16 paths, and the resulting **267 source roots** exactly match the source-path projection of the frozen coherent producer. This is root-path equivalence, not a new whole-source byte-authentication claim.

One pinned compiler invocation exited **0**, listing **433 total files**, including the same **267 source files**, using **normal ambient Node type resolution without a typeRoots override**. The command was:

```text
/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node --require /Users/kjopek/Workspace/safe-bash/tests/compatibility/default-build-alignment-20260829/compiler-read-guard.cjs /Users/kjopek/Workspace/safe-bash/node_modules/typescript/lib/tsc.js -p /Users/kjopek/Workspace/safe-bash/tsconfig.build.json --noEmit --listFiles
```

Run context and read admission are recorded in `INPUT-ADMISSION.json`; the guard uses `SAFE_BASH_INPUT_ADMISSION` pointing to that file. The guard refuses content reads of any unselected source path before opening it. The prior isolated strict build established that the selected roots compile without the held files; the guarded current check also completed without routing any import to an excluded source file.

## Preservation and qualifications

- The 16 held production files were not opened, hashed, evaluated, compiled, edited, or deleted. Metadata-only size/mtime/mode checks are preserved. The 17 documents and 7 scripts remain untouched.
- The reviewed package build script is exactly `tsc -p tsconfig.build.json`; there are no prebuild/postbuild hooks. No npm script was executed. This validates its compiler configuration with no emit, not a newly emitted package or execution of npm itself.
- Compiler/Node/type inputs are authenticated against the existing tool pins. No dependencies, relaxed options, source-module changes, or public-export changes were introduced.
- `tsconfig.json` and all-tests/typecheck workflows are unchanged; this result does not qualify those broader workflows or experimental commands.
- No Shell, Worker, native Bash, install, network, product execution, or smoke. Existing frozen producer commit `ab46a006a0f324a42c563542e4545ce80de49731`, DATA binding `937f1d9317256c18066d9f74c0ae0bb21842bfaa`, its 323-input receipt, and archive remain separate and unchanged.

## Evidence

`RESULT.json`: 12,488 bytes; SHA256 `b6f4e7d9a1200dde380895a47f39af16433f829fd2c40eecdef24b0f11b74930`. `compiler.stdout` is the direct compiler capture; `compiler.stderr` is retained. `INPUT-ADMISSION.json` records the gate before compiler startup.

The first metadata-only scanner refused a symlink in nested tooling before any compiler invocation. Its original `STOP.json`, helper version, and captures remain. The same DATA helper was corrected to use TypeScript's actual config resolver rather than approximating glob traversal. Only one compiler invocation occurred.

Invocation accounting through publication: **22 known OS starts of 24, conservative peak 3**, one DATA helper with two launches (the first stopped before compilation), one compiler. Direct capture preceded every child. `RESOURCE-SAMPLE.txt` records owned-file/capture bytes plus a publication reserve; this is not an OS/RSS or Git-physical quota claim. Atomic explicit-path publication preserves foreign staging.
