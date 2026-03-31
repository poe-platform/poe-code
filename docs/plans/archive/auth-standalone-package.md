# Standalone `@poe-code/auth` Package

## Context

`@poe-code/auth` currently lives at `packages/auth/` with `private: true`. It provides low-level credential storage (`createAuthStore`, `createOAuthClient`) and two backends (encrypted file, macOS keychain). All CLI auth commands and API key validation live in `src/cli/`, tightly coupled to the main CLI container.

**Goal:** Publish `@poe-code/auth` as a standalone package with a simple, flat API that mirrors the CLI. Both SDK users and CLI users get the same 4 operations: login, logout, get token, check auth.

## Design Principle

Other auth libraries (gh, stripe, netlify, vercel) expose simple top-level functions. Nobody wants to `createAuthStore` then `createOAuthClient` then wire them together. The SDK should be as simple as the CLI.

```typescript
// SDK — that's the entire API
import { login, logout, getToken, checkAuth } from "@poe-code/auth"

const token = await getToken()           // string | null
const me = await checkAuth()             // { email, balance } | null
await login()                            // opens browser, stores key
await login({ apiKey: "sk-poe-..." })    // stores explicit key
await logout()                           // removes stored key
```

```bash
# CLI — mirrors the SDK exactly
$ poe-auth login                         # opens browser
$ poe-auth login --api-key sk-poe-...    # stores explicit key
$ poe-auth logout                        # removes stored key
$ poe-auth token                         # prints key to stdout
$ poe-auth whoami                        # shows email + balance
$ poe-auth whoami --json                 # machine-readable
```

The existing low-level API (`createAuthStore`, `createOAuthClient`, backend classes) stays exported for power users / internal use by poe-code, but it's not the primary interface.

## Plan

### Phase 1: Extract internals from CLI into auth package

These steps move logic that currently lives in `src/cli/` into the auth package so it can own the full auth lifecycle.

#### 1.1 API key validation → auth package

**Create:**
- `packages/auth/src/api-key-validation.test.ts` (tests first)
- `packages/auth/src/api-key-validation.ts` — `normalizeApiKey`, `isValidApiKeyFormat`, `stripBracketedPaste`

**Extract from:** `src/cli/options.ts` (lines 12-120)

**Commit:** `refactor(auth): extract API key validation into auth package`

#### 1.2 `checkAuth()` — server-side key verification

**Create:**
- `packages/auth/src/check-auth.test.ts`
- `packages/auth/src/check-auth.ts`

```typescript
interface AuthIdentity {
  email: string;
  balance: number | null;
}

function checkAuth(options?: { apiKey?: string }): Promise<AuthIdentity | null>
```

When called without `apiKey`, reads from stored credentials. Returns `null` if no key stored or key is invalid.

**Commit:** `feat(auth): add checkAuth()`

#### 1.3 `login()` — high-level login

**Create:**
- `packages/auth/src/login.test.ts`
- `packages/auth/src/login.ts`

```typescript
interface LoginOptions {
  apiKey?: string;               // skip OAuth, store this key directly
  openBrowser?: (url: string) => Promise<void>;
  readLine?: () => Promise<string>;
}

function login(options?: LoginOptions): Promise<string>  // returns the API key
```

Internally uses `createAuthStore` + `createOAuthClient` + `isValidApiKeyFormat`. If `apiKey` is provided, validates and stores it. Otherwise runs the OAuth flow.

**Commit:** `feat(auth): add login()`

#### 1.4 `logout()`

**Create:**
- `packages/auth/src/logout.test.ts`
- `packages/auth/src/logout.ts`

```typescript
function logout(): Promise<void>
```

Deletes stored credentials.

**Commit:** `feat(auth): add logout()`

#### 1.5 `getToken()`

**Create:**
- `packages/auth/src/get-token.test.ts`
- `packages/auth/src/get-token.ts`

```typescript
function getToken(): Promise<string | null>
```

Returns stored API key or `null`. That's it.

**Commit:** `feat(auth): add getToken()`

#### 1.6 Export the simple API

**Modify:** `packages/auth/src/index.ts`

```typescript
// Primary API (what users see first)
export { login } from "./login.js"
export { logout } from "./logout.js"
export { getToken } from "./get-token.js"
export { checkAuth } from "./check-auth.js"
export type { LoginOptions } from "./login.js"
export type { AuthIdentity } from "./check-auth.js"

// Low-level API (power users / internal)
export { createAuthStore } from "./create-auth-store.js"
export { createOAuthClient } from "./oauth-client.js"
// ... existing exports unchanged
```

**Commit:** `refactor(auth): export simple top-level API`

### Phase 2: Standalone CLI

#### 2.1 CLI commands

All commands use the simple SDK functions internally — no `AuthCommandDeps` wiring for the standalone binary.

**Create:**
- `packages/auth/src/cli/login-command.test.ts`
- `packages/auth/src/cli/login-command.ts`
- `packages/auth/src/cli/logout-command.test.ts`
- `packages/auth/src/cli/logout-command.ts`
- `packages/auth/src/cli/token-command.test.ts`
- `packages/auth/src/cli/token-command.ts`
- `packages/auth/src/cli/whoami-command.test.ts`
- `packages/auth/src/cli/whoami-command.ts`

```
poe-auth login [--api-key <key>]   # calls login()
poe-auth logout                    # calls logout()
poe-auth token                     # calls getToken(), prints to stdout
poe-auth whoami [--json]           # calls checkAuth(), prints identity
```

**Commit:** `feat(auth): add CLI commands`

#### 2.2 `bin` entry point

**Create:**
- `packages/auth/src/bin.ts` — creates commander program, registers commands from 2.1

**Modify:**
- `packages/auth/package.json` — add `"bin": { "poe-auth": "./dist/bin.js" }`, add `commander` dep

**Commit:** `feat(auth): add standalone poe-auth binary`

### Phase 3: Wire into main CLI

The main poe-code CLI currently has its own login/logout/auth commands with extra hooks (service reconfiguration, config deletion). These need to call the simple SDK functions internally while adding their own hooks on top.

#### 3.1 Refactor main CLI auth commands

**Modify:**
- `src/cli/commands/login.ts` — use `login()` from `@poe-code/auth` internally, add service reconfiguration hook after
- `src/cli/commands/logout.ts` — use `logout()` from `@poe-code/auth` internally, add config deletion + service unconfiguration
- `src/cli/commands/auth.ts` — use `checkAuth()` and `getToken()` for status/api_key subcommands
- `src/cli/options.ts` — import `normalizeApiKey`, `isValidApiKeyFormat` from `@poe-code/auth`, remove local copies

**Delete from `src/cli/`:** validation functions that now live in auth package

**Commit:** `refactor(cli): use @poe-code/auth SDK in auth commands`

### Phase 4: Linux backend

#### 4.1 Linux secret-tool backend

Uses `secret-tool` CLI (libsecret) — works with GNOME Keyring, KWallet, KeePassXC.

```typescript
type AuthBackend = "file" | "keychain" | "secret-tool"
```

**Create:**
- `packages/auth/src/secret-tool-auth-store.test.ts`
- `packages/auth/src/secret-tool-auth-store.ts`

**Modify:**
- `packages/auth/src/types.ts` — extend `AuthBackend`
- `packages/auth/src/create-auth-store.ts` — auto-select on linux if `secret-tool` available, else file

**Commit:** `feat(auth): add Linux secret-tool backend`

### Phase 5: Publishing

#### 5.1 Package metadata

**Modify `packages/auth/package.json`:**
- Remove `"private": true`
- Add `description`, `keywords`, `repository`, `license`, `engines`

#### 5.2 README

**Replace** `packages/auth/README.md` with:
- Installation (`bun add @poe-code/auth`)
- SDK quick start (4 functions)
- CLI usage (`npx poe-auth login`)
- Environment variables (`POE_API_KEY`, `POE_AUTH_BACKEND`)
- Backends (file, keychain, secret-tool)

#### 5.3 Publishing pipeline

Add `@poe-code/auth` to the existing release pipeline. Same beta/stable branch strategy.

---

## Final Public API

```typescript
// === Simple API (primary) ===
login(options?: LoginOptions): Promise<string>
logout(): Promise<void>
getToken(): Promise<string | null>
checkAuth(options?: { apiKey?: string }): Promise<AuthIdentity | null>

// === Types ===
interface LoginOptions {
  apiKey?: string
  openBrowser?: (url: string) => Promise<void>
  readLine?: () => Promise<string>
}

interface AuthIdentity {
  email: string
  balance: number | null
}

// === Low-level (power users / internal) ===
createAuthStore(input?): { store: AuthStore, backend: AuthBackend }
createOAuthClient(config: OAuthClientConfig): OAuthClient
isValidApiKeyFormat(key: string): boolean
normalizeApiKey(raw: string): string
```

## CLI Commands

```
poe-auth login [--api-key <key>]   # OAuth or manual key
poe-auth logout                    # remove stored key
poe-auth token                     # print key to stdout
poe-auth whoami [--json]           # verify key, show identity
```

## Verification

1. `bun run test` — all unit tests pass
2. `bun run lint` — clean
3. `bun run e2e:verbose` — login/logout e2e flows work
4. `bun run screenshot-poe-code -- --help` — help output unchanged
5. `bun run screenshot-poe-code -- login --help` — login help works
