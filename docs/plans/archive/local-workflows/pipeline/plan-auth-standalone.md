---
kind: pipeline
version: 1
tasks:
  - id: rename-to-poe-auth
    title: Rename packages/auth to packages/poe-oauth and update all references
    prompt: >
      Rename the auth package directory and npm package name:

      - Directory: `packages/auth/` → `packages/poe-oauth/`

      - Package name: `@poe-code/auth` → `@poe-code/poe-auth`


      Steps:

      1. `git mv packages/auth packages/poe-oauth`

      2. Update `packages/poe-oauth/package.json` — change `"name"` to `"@poe-code/poe-auth"`

      3. Update all imports and mocks across the codebase (find/replace `@poe-code/auth` →
      `@poe-code/poe-auth`):

         Source files:
         - `src/sdk/container.ts`
         - `src/cli/container.ts`
         - `src/cli/oauth-login.ts`
         - `src/sdk/credentials.ts`
         - `packages/poe-agent/src/agent.ts`
         - `packages/e2e-docker-test-runner/src/credentials.ts`

         Test files:
         - `src/cli/commands/logout-command.test.ts`
         - `src/cli/commands/login-command.test.ts`
         - `src/sdk/credentials.test.ts`
         - `src/sdk/container.test.ts`
         - `packages/e2e-docker-test-runner/src/credentials.test.ts`

      4. Update package.json dependency references:
         - `package.json` (root) — `"@poe-code/auth": "*"` → `"@poe-code/poe-auth": "*"`
         - `packages/poe-agent/package.json` — same
         - `packages/e2e-docker-test-runner/package.json` — same

      5. Update config/build references:
         - `e2e/vitest.config.ts` — update path `'../packages/auth/src'` → `'../packages/poe-oauth/src'` and alias key `'@poe-code/auth'` → `'@poe-code/poe-auth'`
         - `packages/e2e-docker-test-runner/src/image.ts` — update `packageDir: 'packages/auth'` → `packageDir: 'packages/poe-oauth'`

      6. Run `npm install` to regenerate package-lock.json

      7. Run `npm run test` and `npm run lint` to verify nothing is broken


      Do NOT update docs/plans — those are planning docs and will be updated separately.


      Commit: `refactor(auth): rename packages/auth to packages/poe-oauth`
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: api-key-validation
    title: Extract API key validation into auth package
    prompt: >
      Extract API key validation functions from `src/cli/options.ts` (lines 12-120) into the auth
      package.


      Create TDD-first:

      - `packages/poe-oauth/src/api-key-validation.test.ts`

      - `packages/poe-oauth/src/api-key-validation.ts`


      Functions to extract:

      - `stripBracketedPaste(input: string): string` — removes bracketed paste escape sequences

      - `isValidApiKeyFormat(key: string): boolean` — checks minimum 34 chars, matches
      `sk-poe-<hash>` or raw alphanumeric with hyphens/underscores

      - `normalizeApiKey(raw: string): string` — trims, strips bracketed paste, validates format


      Internal helpers (not exported): `isAlphanumeric`, `isAlphanumericWithSeparators`,
      `hasMinimumApiKeyLength`.


      Export all three public functions from `packages/poe-oauth/src/index.ts`.


      Do NOT modify `src/cli/options.ts` yet — that happens in a later task.


      Commit: `refactor(auth): extract API key validation into auth package`
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: check-auth
    title: Add checkAuth() — server-side key verification
    prompt: >
      Add a `checkAuth()` function to the auth package that verifies an API key against the Poe
      server and returns user identity.


      Create TDD-first:

      - `packages/poe-oauth/src/check-auth.test.ts`

      - `packages/poe-oauth/src/check-auth.ts`


      Interface:

      ```typescript

      interface AuthIdentity {
        email: string;
        balance: number | null;
      }


      function checkAuth(options?: {
        apiKey?: string;
        baseUrl?: string;       // default: https://poe.com
        fetch?: typeof fetch;   // injectable for testing
      }): Promise<AuthIdentity | null>

      ```


      Behavior:

      - If `apiKey` is provided, use it directly

      - If `apiKey` is omitted, read from stored credentials via
      `createAuthStore().store.getApiKey()`

      - If no key available, return `null`

      - Call `GET ${baseUrl}/usage/current_balance` with header `Authorization: Bearer ${apiKey}`

      - If response is OK, parse and return `{ email, balance }`

      - If response is 401/403 or network error, return `null`


      Reference: `src/cli/commands/auth.ts` has existing inline balance-check logic — match its
      endpoint and response parsing.


      Export `checkAuth` and `AuthIdentity` from `packages/poe-oauth/src/index.ts`.


      Tests must mock `fetch` — do NOT make real HTTP calls.


      Commit: `feat(auth): add checkAuth()`
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: login-fn
    title: Add login() — high-level OAuth + manual key login
    prompt: >
      Add a `login()` function to the auth package that handles the full login flow (OAuth or
      explicit API key).


      Create TDD-first:

      - `packages/poe-oauth/src/login.test.ts`

      - `packages/poe-oauth/src/login.ts`


      Interface:

      ```typescript

      interface LoginOptions {
        apiKey?: string;
        openBrowser?: (url: string) => Promise<void>;
        readLine?: () => Promise<string>;
      }


      function login(options?: LoginOptions): Promise<string>  // returns the stored API key

      ```


      Behavior:

      - If `options.apiKey` is provided: validate with `isValidApiKeyFormat()`, store via
      `createAuthStore().store.setApiKey()`, return the key

      - If no `apiKey`: run OAuth flow via `createOAuthClient()` with Poe's OAuth config (clientId,
      endpoints — see `src/cli/oauth-login.ts` for the current values), store the returned key,
      return it

      - Throw if validation fails or OAuth errors


      OAuth config to use (extract from `src/cli/oauth-login.ts`):

      - `clientId`: the value currently hardcoded there

      - `authorizationEndpoint`: the value currently hardcoded there

      - `tokenEndpoint`: the value currently hardcoded there


      The `openBrowser` and `readLine` options are passed through to `createOAuthClient()`.


      Export `login` and `LoginOptions` from `packages/poe-oauth/src/index.ts`.


      Tests must mock `createAuthStore` and `createOAuthClient` — do NOT open real browsers or start
      real servers.


      Commit: `feat(auth): add login()`
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: logout-fn
    title: Add logout()
    prompt: |
      Add a `logout()` function to the auth package.

      Create TDD-first:
      - `packages/poe-oauth/src/logout.test.ts`
      - `packages/poe-oauth/src/logout.ts`

      Interface:
      ```typescript
      function logout(): Promise<void>
      ```

      Behavior: calls `createAuthStore().store.deleteApiKey()`.

      Export from `packages/poe-oauth/src/index.ts`.

      Commit: `feat(auth): add logout()`
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: get-token-fn
    title: Add getToken()
    prompt: |
      Add a `getToken()` function to the auth package.

      Create TDD-first:
      - `packages/poe-oauth/src/get-token.test.ts`
      - `packages/poe-oauth/src/get-token.ts`

      Interface:
      ```typescript
      function getToken(): Promise<string | null>
      ```

      Behavior: calls `createAuthStore().store.getApiKey()` and returns the result.

      Export from `packages/poe-oauth/src/index.ts`.

      Commit: `feat(auth): add getToken()`
    status:
      implement: done
      refactor: done
      test: done
      commit: open
  - id: cli-commands
    title: Add standalone poe-auth CLI commands
    prompt: >
      Create CLI commands for the standalone `poe-auth` binary. Each command calls the simple SDK
      functions.


      Create TDD-first in `packages/poe-oauth/src/cli/`:


      1. `login-command.ts` + `login-command.test.ts`
         - `poe-auth login [--api-key <key>]`
         - Calls `login({ apiKey })` from the SDK
         - On success, prints confirmation message

      2. `logout-command.ts` + `logout-command.test.ts`
         - `poe-auth logout`
         - Calls `logout()` from the SDK
         - Prints confirmation

      3. `token-command.ts` + `token-command.test.ts`
         - `poe-auth token`
         - Calls `getToken()`, prints raw key to stdout (for piping: `export POE_API_KEY=$(poe-auth token)`)
         - If no key stored, exit with code 1 and print error to stderr

      4. `whoami-command.ts` + `whoami-command.test.ts`
         - `poe-auth whoami [--json]`
         - Calls `checkAuth()`, prints email + balance
         - With `--json`, prints `{"email":"...","balance":...}`
         - If not logged in, exit with code 1

      Each command exports a `register*Command(program: Command)` function that takes a commander
      `Command` instance.


      Use `commander` for arg parsing. Use `@poe-code/design-system` for styled output where
      available, otherwise plain console output is fine.


      Commit: `feat(auth): add CLI commands`
    status:
      implement: open
      refactor: open
      test: open
      commit: open
  - id: cli-bin
    title: Add standalone poe-auth binary entry point
    prompt: |
      Create the `poe-auth` binary entry point that wires together all CLI commands.

      Create:
      - `packages/poe-oauth/src/bin.ts`

      This file should:
      1. `#!/usr/bin/env node` shebang
      2. Create a commander program with name `poe-auth`, version from package.json
      3. Register all commands from the cli/ directory (login, logout, token, whoami)
      4. Call `program.parse()`

      Modify `packages/poe-oauth/package.json`:
      - Add `"bin": { "poe-auth": "./dist/bin.js" }`
      - Add `commander` as a dependency

      Commit: `feat(auth): add standalone poe-auth binary`
    status:
      implement: open
      refactor: open
      test: open
      commit: open
  - id: wire-main-cli
    title: Refactor main CLI to use @poe-code/poe-auth SDK
    prompt: >
      Refactor the main poe-code CLI auth commands to use the simple SDK functions from
      `@poe-code/poe-auth` internally.


      Modify:

      - `src/cli/commands/login.ts` — use `login()` from `@poe-code/poe-auth` for the core flow,
      keep the service reconfiguration hook that runs after login succeeds

      - `src/cli/commands/logout.ts` — use `logout()` from `@poe-code/poe-auth` for credential
      deletion, keep config file deletion + service unconfiguration hooks

      - `src/cli/commands/auth.ts` — use `checkAuth()` for the status subcommand, use `getToken()`
      for the api_key subcommand

      - `src/cli/options.ts` — import `normalizeApiKey`, `isValidApiKeyFormat` from
      `@poe-code/poe-auth`, remove the local implementations (lines 12-120)


      The main CLI commands do MORE than the standalone ones (service reconfiguration, config
      deletion), so they wrap the SDK functions with additional hooks. Do not remove that extra
      behavior.


      Ensure all existing tests still pass. Update test mocks if needed.


      Commit: `refactor(cli): use @poe-code/poe-auth SDK in auth commands`
    status:
      implement: open
      refactor: open
      test: open
      commit: open
  - id: linux-secret-tool
    title: Add Linux secret-tool backend
    prompt: >
      Add a Linux credential backend using `secret-tool` CLI (libsecret), which works with GNOME
      Keyring, KWallet, and KeePassXC.


      Create TDD-first:

      - `packages/poe-oauth/src/secret-tool-auth-store.test.ts`

      - `packages/poe-oauth/src/secret-tool-auth-store.ts`


      The backend should implement the `AuthStore` interface using these commands:

      - `secret-tool lookup service poe-code account api-key` → getApiKey

      - `secret-tool store --label='poe-code' service poe-code account api-key` (value piped via
      stdin) → setApiKey

      - `secret-tool clear service poe-code account api-key` → deleteApiKey


      Follow the same patterns as `keychain-auth-store.ts`:

      - Injectable command runner for testing

      - Proper error handling for "not found" vs actual errors

      - Handle exit codes


      Modify:

      - `packages/poe-oauth/src/types.ts` — extend `AuthBackend` to `"file" | "keychain" |
      "secret-tool"`

      - `packages/poe-oauth/src/create-auth-store.ts` — add backend selection:
        - If `POE_AUTH_BACKEND=secret-tool` → use it (error if not linux)
        - If `POE_AUTH_BACKEND` not set and platform is linux → check if `secret-tool` binary exists (via `which`), use it if available, else fall back to file
        - Existing keychain logic unchanged (macOS only)

      Commit: `feat(auth): add Linux secret-tool backend`
    status:
      implement: open
      refactor: open
      test: open
      commit: open
  - id: publish-prep
    title: Prepare @poe-code/poe-auth for npm publishing
    prompt: >
      Prepare the auth package for standalone npm publishing.


      Modify `packages/poe-oauth/package.json`:

      - Remove `"private": true`

      - Set version to match the monorepo version or `1.0.0`

      - Add `"description": "Secure credential storage and OAuth login for the Poe API"`

      - Add `"keywords": ["poe", "auth", "oauth", "api-key", "credential-storage"]`

      - Add `"repository"`, `"license"`, `"engines"` fields matching the root package.json
      conventions


      Replace `packages/poe-oauth/README.md` with a proper public README containing:

      - Package description

      - Installation: `npm install @poe-code/poe-auth`

      - SDK quick start showing the 4 functions: `login`, `logout`, `getToken`, `checkAuth`

      - CLI usage: `npx poe-auth login`, `npx poe-auth logout`, `npx poe-auth token`, `npx poe-auth
      whoami`

      - Environment variables: `POE_API_KEY`, `POE_AUTH_BACKEND`

      - Backends: file (default, all platforms), keychain (macOS), secret-tool (Linux)


      Add `@poe-code/poe-auth` to the existing release pipeline so it publishes alongside poe-code
      on the beta and main branches.


      Commit: `chore(auth): prepare @poe-code/poe-auth for npm publishing`
    status:
      implement: open
      refactor: open
      test: open
      commit: open
---

# auth standalone

Archived local pipeline plan converted from YAML during docs cleanup.
