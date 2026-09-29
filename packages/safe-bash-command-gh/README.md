# safe-bash-command-gh

GitHub CLI (`gh`) command plugin for `@poe-platform/safe-bash`, written in pure portable TypeScript with VFS Git repository integration, full Pull Request lifecycle management, repository cloning/forking, REST & GraphQL API invocation, `jq` and Go-template output formatting, and injectable OpenSSH / OpenSSL providers.

## Feature Index

| Command Family | Subcommands | Key Capabilities |
| :--- | :--- | :--- |
| `gh pr` | `create`, `list`, `view`, `checkout`, `diff`, `merge`, `review`, `checks`, `comment`, `edit`, `close`, `reopen`, `ready`, `lock`, `unlock`, `status`, `update-branch`, `revert` | Full PR creation (`--fill`, `--fill-first`, `--fill-verbose`, `--draft`, `--template`, `--dry-run`), VFS Git checkout (`-b`, `--detach`), unified diffs (`--name-only`, `--patch`), merge/squash/rebase (`--auto`, `--delete-branch`, `--match-head-commit`), reviews (`--approve`, `--request-changes`, `--comment`), CI status checks (exit codes `0`/`1`/`8`), `--json` / `--jq` / `--template` |
| `gh repo` | `clone`, `create`, `fork`, `view`, `list`, `sync`, `set-default`, `edit`, `delete`, `archive`, `unarchive`, `rename`, `deploy-key`, `credits`, `gitignore`, `license` | Clones repositories into `safe-fs` with real `.git` history and automatic `origin` / `upstream` fork remotes; creates & forks repos with `--clone` or `--source --push` |
| `gh issue` | `create`, `list`, `view`, `edit`, `close`, `reopen`, `comment`, `delete`, `lock`, `unlock`, `pin`, `unpin`, `status`, `transfer`, `develop` | Issue lifecycle, linked branch creation (`gh issue develop --checkout`), cross-repo issue transfer |
| `gh project`, `gh ruleset`, `gh org`, `gh extension`, `gh codespace` | `create`, `list`, `view`, `edit`, `close`, `delete`, `field-*`, `item-*`, `check`, `install`, `stop` | GitHub Projects v2 management, repository rulesets, organization listings, extensions, and codespace state management |
| `gh api` | REST & `graphql` | `:owner`/`:repo`/`:branch` expansion, `-f` raw fields, `-F` typed/file/nested fields, `--input`, `--paginate`, `--slurp`, `--include`, `--jq`, `--template` |
| `gh auth` | `login`, `logout`, `status`, `token`, `switch`, `refresh`, `setup-git` | Multi-account & multi-host auth state persisted in `~/.config/gh/hosts.yml`, `GH_TOKEN`/`GITHUB_TOKEN` support |
| `gh release` | `create`, `list`, `view`, `edit`, `upload`, `download`, `delete`, `delete-asset`, `verify`, `verify-asset` | VFS asset upload/download, `--generate-notes`, attestation verification |
| `gh run` & `gh workflow` | `list`, `view`, `watch`, `rerun`, `cancel`, `delete`, `download`, `run`, `enable`, `disable` | Workflow dispatch, job log inspection (`--log`, `--log-failed`), VFS artifact extraction |
| `gh gist`, `gh search`, `gh label` | `create`, `list`, `view`, `edit`, `clone`, `delete`, `rename`, `prs`, `issues`, `repos`, `commits`, `code` | Gist VFS cloning, multi-entity search qualifiers, label management |
| `gh secret`, `gh variable`, `gh cache`, `gh ssh-key`, `gh gpg-key`, `gh attestation`, `gh config`, `gh alias`, `gh status`, `gh browse` | Full management subcommands | Sealed-box secret encryption via injectable OpenSSL, SSH key fingerprinting via injectable OpenSSH, recursive alias expansion |

## Quick Start

```typescript
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createGitCommand } from "safe-bash-command-git";
import { createGhCommand, createGitHubBackend } from "safe-bash-command-gh";

const fs = new MemoryFileSystem();
const backend = createGitHubBackend({ defaultUser: "octocat" });
const gh = createGhCommand({
  backend,
  git: createGitCommand(),
});
```

## Injectable / Faked OpenSSH & OpenSSL and Skipped Host Capabilities

- **Injectable & Faked OpenSSL (`options.openssl` / `GhOpenSslProvider`)**:
  - Provides pure-TypeScript `sha1`, `sha256`, `hmacSha256`, deterministic `randomBytes`, `generateRsaKeyPair`, `x509SelfSignedCert`, `encryptSecretForGitHub` (used by `gh secret set`), and `verifyAttestationSignature` (used by `gh attestation verify` and `gh release verify`). Any method can be overridden via `options.openssl`.
- **Injectable & Faked OpenSSH (`options.ssh` / `GhSshProvider`)**:
  - Provides deterministic `keygen` (`ed25519`, `rsa`, `ecdsa`), `fingerprint` (`SHA256:...`), `parsePublicKey`, `sign`, `verify`, and `connect` (used by `gh repo clone` over SSH and `gh ssh-key add`). Any method can be overridden via `options.ssh`.
- **Explicitly Skipped Host/Interactive Features**:
  - **Interactive Browser OAuth Device Flow & Native System Keychain (`keytar`/macOS Keychain/libsecret)**: Browser login flows are replaced by `--with-token`, environment variables (`GH_TOKEN`, `GITHUB_TOKEN`, `GH_ENTERPRISE_TOKEN`), and VFS `~/.config/gh/hosts.yml`.
  - **Interactive Terminal Survey Prompts (`AlecAivazis/survey`) & External TUI Pagers**: All commands run non-interactively via CLI flags, stdin, `--fill`, and VFS templates.
  - **Codespaces SSH Daemon / Port Forwarding (`gh codespace`) & Native `gh extension` Binary Execution**: Excluded because virtual shell sandboxes do not spawn host OS daemons or download native platform binaries.
