# git-rust

Full-featured Rust Git implementation with both a standalone native CLI binary (`git-rust`) for local host development and a zero-dependency WebAssembly engine for `@poe-platform/safe-bash`.

## Why git-rust?

- **Drop-in `git` CLI replacement (`git-rust`)**: Run standard Git workflows (`init`, `clone`, `fetch`, `pull`, `push`, `commit -S`, `tag -s`, `rebase`, `merge`, `stash`, `worktree`, `submodule`, `blame`, `bisect`, `archive`) directly against your local filesystem, `~/.gitconfig`, `~/.ssh`, and HTTPS credential helpers.
- **Built-in OpenSSH & OpenPGP Signing**: Sign and verify commits and annotated tags (`git commit -S`, `git tag -s`, `git verify-commit`, `git verify-tag`, `git log --show-signature`) using either `gpg.format = ssh` (`openssh-key-v1` Ed25519 & `SSHSIG` v1) or `gpg.format = openpgp` (RFC 4880 OpenPGP v4 Ed25519) without external daemon dependencies.
- **SSH & Smart HTTP Transport**: Clone, fetch, pull, and push over `git@host:owner/repo.git`, `ssh://user@host:port/repo.git`, `https://`, and local paths with `~/.ssh/config` host aliases, `known_hosts` verification (`StrictHostKeyChecking`), and `authorized_keys` public-key authentication.
- **Client & Server Git Hooks**: Execute `pre-commit`, `prepare-commit-msg`, `commit-msg`, `post-commit`, `post-rewrite`, `post-checkout`, `post-merge`, `pre-rebase`, `pre-push`, and server-side `pre-receive`, `update`, and `post-receive` hooks with full `core.hooksPath` and `--no-verify` support.

## Feature Index Card

| Category | Supported Commands & Capabilities |
| --- | --- |
| **Porcelain & History** | `init`, `clone`, `add`, `mv`, `rm`, `restore`, `reset`, `status`, `commit`, `amend`, `log`, `show`, `diff`, `blame`, `shortlog`, `describe`, `reflog`, `bisect`, `grep` |
| **Branching & History Rewrite** | `branch`, `checkout`, `switch`, `merge`, `rebase` (`--onto`, `--abort`, `--continue`), `cherry-pick`, `revert`, `stash`, `tag`, `worktree`, `submodule`, `notes`, `replace` |
| **Signing & Verification** | `commit -S` / `--gpg-sign`, `tag -s` / `-u`, `verify-commit`, `verify-tag`, `log --show-signature`, `gpg.format = openpgp \| ssh`, `gpg.ssh.allowedSignersFile` |
| **Network & Wire Transport** | `fetch`, `pull`, `push`, `remote`, `ls-remote`, `upload-pack`, `receive-pack`, `bundle`, `archive`, `format-patch`, `am`, `apply` |
| **Hooks Lifecycle** | `pre-commit`, `prepare-commit-msg`, `commit-msg`, `post-commit`, `post-rewrite`, `post-checkout`, `post-merge`, `pre-rebase`, `pre-push`, `pre-receive`, `update`, `post-receive` |

## Using `git-rust` as Your Local `git` CLI

Build and install the native `git-rust` binary to `~/.local/bin`:

```bash
cargo build --release --manifest-path packages/git-rust/Cargo.toml --bin git-rust
cp packages/git-rust/target/release/git-rust ~/.local/bin/git-rust

# Optional: alias git to git-rust in your shell
alias git=git-rust
```

### Signing Commits & Tags with SSH Keys

```bash
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -C "alice@example.com" -N ""
echo "alice@example.com $(cat ~/.ssh/id_ed25519.pub)" > ~/.ssh/allowed_signers

git-rust config gpg.format ssh
git-rust config user.signingkey ~/.ssh/id_ed25519
git-rust config gpg.ssh.allowedSignersFile ~/.ssh/allowed_signers

git-rust commit -S -m "feat: signed with Ed25519 SSH key"
git-rust verify-commit HEAD
git-rust log -1 --show-signature
```
