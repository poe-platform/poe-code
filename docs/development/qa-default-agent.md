# QA: default agent env var

Use a real plan path for step 2, for example `docs/plans/<plan>.md`.

## 1. Set the env default and verify `configure`

```bash
export POE_DEFAULT_AGENT=claude-code
npm run dev -- configure
```

Verify no agent prompt appears and the command continues with `claude-code`.

## 2. With the env var still set, verify `ralph run`

```bash
npm run dev -- ralph run <some-plan>
```

Verify no agent prompt appears and the command continues with `claude-code`.

## 3. Verify CLI args override the env var

```bash
npm run dev -- configure --agent codex
```

Verify the command uses `codex`, not `claude-code`.

## 4. Verify an invalid env default fails fast

```bash
export POE_DEFAULT_AGENT=not-a-real-agent
npm run dev -- configure
```

Verify a `ValidationError` mentioning `core.defaultAgent` is printed, the process exits non-zero, and no prompt appears.

## 5. Clear the env var and verify the prompt returns

```bash
unset POE_DEFAULT_AGENT
npm run dev -- configure
```

Verify the agent prompt appears again.
