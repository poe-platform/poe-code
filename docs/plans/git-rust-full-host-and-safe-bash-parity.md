# Plan: `git-rust` Full Host & `safe-bash` Parity (SSH Transport, OpenSSL/OpenSSH, GPG/SSH Signing, Git Hooks, and Native `git-rust` CLI)

## Overview

Extend `packages/git-rust` and `@poe-platform/safe-bash` so that `git-rust` can serve as a complete drop-in replacement for `git` both inside `@poe-platform/safe-bash` (WASM/virtual filesystem) and as a native local OS binary (`git-rust`).

## Scope & Deliverables

### 1. Cryptographic & Signing Engine (`packages/git-rust/src/crypto.rs`)
- Pure-Rust Ed25519 (RFC 8032), SHA-256 / SHA-512 (FIPS 180-4), HMAC, AES-256-CBC / CTR, PBKDF2-HMAC-SHA256, OpenSSH private/public key format (`openssh-key-v1`), OpenSSH `SSHSIG` v1 signature generation & verification (`-----BEGIN SSH SIGNATURE-----`), and OpenPGP (`-----BEGIN PGP SIGNATURE-----` RFC 4880 v4 Ed25519 signature packet generation & verification).
- Git commit & tag signing (`commit -S` / `--gpg-sign[=<key-id>]` / `--no-gpg-sign`, `commit.gpgsign`, `user.signingkey`, `gpg.format = openpgp | ssh | x509`, `gpg.ssh.allowedSignersFile`, `tag -s`, `tag -u <key-id>`, `tag -v`, `verify-commit`, `verify-tag`, `log --show-signature`, `merge --verify-signatures`).

### 2. Git Hooks Lifecycle (`packages/git-rust/src/hooks.rs` & `packages/safe-bash-command-git`)
- Full Git hook discovery (`core.hooksPath`, `<gitdir>/hooks/<name>`, `<commondir>/hooks/<name>`) and `--no-verify` (`-n`) flag handling.
- Hook lifecycle support:
  - `pre-commit`, `prepare-commit-msg`, `commit-msg`, `post-commit`
  - `pre-rebase`, `post-checkout`, `post-merge`, `post-rewrite`
  - `pre-push`, `pre-receive`, `update`, `post-receive`, `pre-auto-gc`
- Execution across all runtimes:
  - Built-in portable shell script evaluator in `packages/git-rust` for unit tests and standalone WASM callers.
  - Host shell execution (`/bin/sh` / shebang) in native `git-rust` CLI (`src/main.rs`).
  - `@poe-platform/safe-bash` subshell callback in `packages/safe-bash-command-git` so hooks in `safe-bash` execute with the full `safe-bash` command suite and environment.

### 3. SSH Transport (`packages/git-rust/src/ssh.rs`)
- Full SSH URL & config parser:
  - `git@github.com:owner/repo.git` (SCP-like syntax)
  - `ssh://[user@]host[:port]/path/to/repo.git`
  - `~/.ssh/config` (`Host`, `HostName`, `User`, `Port`, `IdentityFile`)
  - `GIT_SSH_COMMAND`, `GIT_SSH`, and `core.sshCommand`
- Portable virtual SSH transport (`MemoryFs` / WASM / unit tests) supporting `clone`, `fetch`, `pull`, `push`, and `ls-remote` over `ssh://` and `git@host:path` URLs with host-key checking (`known_hosts`) and identity-key authentication (`id_ed25519` / `id_rsa`).
- Native OS SSH transport (`src/main.rs`) spawning `ssh` / `GIT_SSH_COMMAND` (`git-upload-pack` / `git-receive-pack`) over pkt-line streams.

### 4. `@poe-platform/safe-bash` Command Packages (`openssl`, `ssh` / `ssh-keygen`, `gpg`)
- `packages/safe-bash-command-openssl` + `packages/safe-bash/src/commands/openssl/index.ts`:
  - `openssl dgst`, `openssl enc`, `openssl rand`, `openssl genpkey`, `openssl pkey`, `openssl genrsa`, `openssl rsa`, `openssl req`, `openssl x509`, `openssl base64`, `openssl passwd`, `openssl version`.
- `packages/safe-bash-command-ssh` + `packages/safe-bash/src/commands/ssh/index.ts`:
  - `ssh-keygen` (`-t ed25519|rsa|ecdsa`, `-f`, `-C`, `-N`, `-y`, `-l`, `-E`, `-F`, `-R`, `-Y sign`, `-Y verify`, `-Y find-principals`, `-Y check-novalidate`) and `ssh` client (`-i`, `-p`, `-o`, `-F`, `-T`, `-V`, `git-upload-pack`, `git-receive-pack`).
- `packages/safe-bash-command-gpg` + `packages/safe-bash/src/commands/gpg/index.ts`:
  - `gpg` (`--batch`, `--generate-key`, `--full-generate-key`, `--list-keys`, `--list-secret-keys`, `--fingerprint`, `--export`, `--export-secret-keys`, `--import`, `--detach-sign`, `--armor`, `--sign`, `--clearsign`, `--verify`, `--status-fd`, `--local-user`, `--encrypt`, `--decrypt`, `--symmetric`).

### 5. Standalone Native `git-rust` CLI (`packages/git-rust/src/main.rs`)
- `[[bin]] name = "git-rust"` in `packages/git-rust/Cargo.toml`.
- Direct host filesystem bridge (`std::fs`) preserving file permissions (`0o755`/`0o644`), symlinks, `.git` directory/worktree pointers, global/system Git config (`~/.gitconfig`, `~/.config/git/config`), environment variables (`GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_AUTHOR_*`, `GIT_COMMITTER_*`), native HTTP/HTTPS transport (`curl` + `git credential fill`), native SSH transport (`ssh`), native hook execution, and local binary installation (`~/.cargo/bin/git-rust`).
