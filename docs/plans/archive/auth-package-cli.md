# Move Auth CLI Commands into `@poe-code/auth`

## Context

The auth package (`packages/auth/`) currently only owns credential storage (AuthStore, encrypted file backend, keychain backend). Auth CLI commands (`login`, `logout`, `auth status`, `auth api_key`) and API key validation live in `src/cli/commands/` and `src/cli/options.ts`, tightly coupled to the main CLI's container.

**Goal:** Make `@poe-code/auth` own everything auth-related so that adding a new auth method (e.g., OAuth) only requires changes in the auth package. The package will depend on `commander` and `@poe-code/design-system`.

## Architecture

The auth package exports `registerAuthCommands(program, deps)` which registers all auth commands. It defines an `AuthCommandDeps` interface for external dependencies.

**Auth package owns:** command registration, auth flows, API key validation, credential storage, balance checking, login prompt descriptor.

**CLI provides via hooks:** service reconfiguration on login, service unconfiguration + config deletion on logout, listing configured agents. These are closures over `program` and `container`.

**Key type trick:** Auth package defines narrow interfaces (`AuthLogger`, `AuthContext`) that the CLI's `ScopedLogger` and `CommandContext` structurally satisfy — no proxy functions needed.

```
┌─────────────────────────────────────┐
│         @poe-code/auth              │
│                                     │
│  AuthStore (existing)               │
│  API key validation (new)           │
│  Login prompt (new)                 │
│  registerAuthCommands(program, deps)│
│    ├─ login                         │
│    ├─ logout                        │
│    └─ auth (status, api_key,        │
│           login, logout)            │
│                                     │
│  deps: AuthCommandDeps {            │
│    readApiKey, writeApiKey,         │
│    prompts, httpClient,             │
│    createResources,                 │
│    hooks: {                         │
│      reconfigureOnLogin(apiKey)     │
│      logout() → {deleted}          │
│      loadConfiguredAgents() → []   │
│    }                                │
│  }                                  │
└─────────────────────────────────────┘
         ▲ imported by
┌─────────────────────────────────────┐
│           Main CLI (program.ts)     │
│                                     │
│  Creates AuthCommandDeps from       │
│  CliContainer (structural typing)   │
│  Implements hooks as closures       │
└─────────────────────────────────────┘
```

## Steps

### Step 1: API key validation → auth package

**Create:**
- `packages/auth/src/api-key-validation.test.ts` (tests first)
- `packages/auth/src/api-key-validation.ts` — `normalizeApiKey`, `isValidApiKeyFormat`, `stripBracketedPaste`

**Extract from:** `src/cli/options.ts` (lines 12-120: `stripBracketedPaste`, `isAlphanumeric`, `isAlphanumericWithSeparators`, `hasMinimumApiKeyLength`, `isValidApiKeyFormat`, plus `normalizeApiKey` from the closure)

**Modify:** `packages/auth/src/index.ts` — add exports

**Commit:** `refactor(auth): extract API key validation into auth package`

### Step 2: Login prompt → auth package

**Create:**
- `packages/auth/src/login-prompt.test.ts` (tests first)
- `packages/auth/src/login-prompt.ts` — `createLoginApiKeyPrompt()`, `AuthPromptDescriptor` type

**Extract from:** `src/cli/prompts.ts` (lines 43-48: `loginApiKey`)

**Modify:** `packages/auth/src/index.ts` — add exports

**Commit:** `refactor(auth): extract login prompt into auth package`

### Step 3: Auth CLI types + errors

**Create:**
- `packages/auth/src/cli/types.ts` — `AuthCommandDeps`, `AuthCommandHooks`, `AuthLogger`, `AuthContext`, `AuthHttpClient`, `AuthPromptFn`, `AuthCommandFlags`
- `packages/auth/src/errors.ts` — `AuthValidationError`, `AuthApiError`
- `packages/auth/src/errors.test.ts`

**Modify:** `packages/auth/src/index.ts` — add exports

**Commit:** `refactor(auth): add auth CLI types and error classes`

### Step 4: Login command in auth package

**Create:**
- `packages/auth/src/cli/login.test.ts` (tests first — mock AuthCommandDeps)
- `packages/auth/src/cli/login.ts` — `registerLoginCommand(program, deps)`

**Port from:** `src/cli/commands/login.ts` — `resolveApiKeyInput` becomes internal, `reconfigureServices` becomes `deps.hooks.reconfigureOnLogin(apiKey)`, uses `normalizeApiKey` from `../api-key-validation.js`

**Commit:** `feat(auth): implement login command in auth package`

### Step 5: Logout command in auth package

**Create:**
- `packages/auth/src/cli/logout.test.ts` (tests first)
- `packages/auth/src/cli/logout.ts` — `registerLogoutCommand(program, deps)`

**Port from:** `src/cli/commands/logout.ts` — unconfigure-all + deleteConfig becomes `deps.hooks.logout()`

**Commit:** `feat(auth): implement logout command in auth package`

### Step 6: Auth status + api_key in auth package

**Create:**
- `packages/auth/src/cli/status.test.ts` (tests first)
- `packages/auth/src/cli/status.ts` — `registerAuthCommand(program, deps)` with `status`, `api_key`, `login`, `logout` subcommands

**Port from:** `src/cli/commands/auth.ts` — `loadConfiguredServices` becomes `deps.hooks.loadConfiguredAgents()`

**Commit:** `feat(auth): implement auth status command in auth package`

### Step 7: Register entry point

**Create:**
- `packages/auth/src/cli/register.test.ts`
- `packages/auth/src/cli/register.ts` — `registerAuthCommands(program, deps)` calls all register functions

**Modify:**
- `packages/auth/src/index.ts` — export `registerAuthCommands` and all CLI types
- `packages/auth/package.json` — add `commander` (peer dep), `@poe-code/design-system` (dep)

**Commit:** `feat(auth): add registerAuthCommands entry point`

### Step 8: Wire in main CLI + cleanup

**Modify:**
- `src/cli/program.ts` — import `registerAuthCommands` from `@poe-code/auth`, create `AuthCommandDeps` from container, replace three `register*` calls with one. Hook implementations are closures over `program`/`container`.
- `src/cli/options.ts` — import `normalizeApiKey`, `isValidApiKeyFormat` from `@poe-code/auth`, remove local implementations
- `src/cli/prompts.ts` — import `createLoginApiKeyPrompt` from `@poe-code/auth`, remove local `loginApiKey`

**Delete:**
- `src/cli/commands/login.ts`
- `src/cli/commands/logout.ts`
- `src/cli/commands/auth.ts`
- `src/cli/commands/login-command.test.ts`
- `src/cli/commands/logout-command.test.ts`
- `src/cli/commands/auth-command.test.ts`

**Commit:** `refactor(cli): wire auth commands from @poe-code/auth`

## Verification

1. `npm run test` — all unit tests pass
2. `npm run lint` — clean
3. `npm run e2e:verbose` — login/logout/configure e2e flows work
4. `npm run screenshot-poe-code -- --help` — help output unchanged
5. `npm run screenshot-poe-code -- login --help` — login help works
6. `npm run screenshot-poe-code -- auth status --help` — status help works
