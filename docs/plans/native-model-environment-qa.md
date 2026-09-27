# Native E2E model environment QA

After changing E2E model selection or process environment forwarding, verify the native process boundary alongside the pure resolver unit tests.

1. Import `resolveE2eModel` and `resolveE2eModelEnvironment` from `e2e/runtime-models.ts` using Node with `--import tsx`.
2. For both an absent `POE_CODE_E2E_GOOSE_MODEL` and the literal override `custom/model; literal`, resolve the Goose model and its environment.
3. Require the environment to equal `{ GOOSE_MODEL: override ?? 'gpt-5.4' }`.
4. Launch `process.execPath` with arguments `['-e', "process.stdout.write(process.env.GOOSE_MODEL ?? '')"]`, encoding `utf8`, and environment `{ ...process.env, ...env }`. Require stdout to equal the resolved model exactly, preserving the override as literal text.
5. Record temporary evidence in `out/` and purge it after verification.

Both original subprocess cases passed unchanged on 27 September 2026. Unit coverage retains default and literal-override selection and the unchanged environments for Claude, Codex and OpenCode, without repeated native process startup.
