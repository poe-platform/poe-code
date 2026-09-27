# git-rust

Full-featured Rust Git implementation with both a standalone native CLI binary (`git-rust`) for local host development and an import-free WebAssembly engine for `@poe-platform/safe-bash`.

## Why git-rust?

- **Drop-in `git` CLI replacement (`git-rust`)**: Run standard Git workflows (`init`, `clone`, `fetch`, `pull`, `push`, `commit -S`, `tag -s`, `rebase`, `merge`, `stash`, `worktree`, `submodule`, `blame`, `bisect`, `archive`) directly against your local filesystem, `~/.gitconfig`, `~/.ssh`, and HTTPS credential helpers.
- **Built-in OpenSSH & OpenPGP Signing**: Sign and verify commits and annotated tags (`git commit -S`, `git tag -s`, `git verify-commit`, `git verify-tag`, `git log --show-signature`) honoring `commit.gpgsign` and `tag.gpgSign` with invocation-only `--no-gpg-sign` / `--no-sign` overrides, using either `gpg.format = ssh` (`openssh-key-v1` Ed25519 & `SSHSIG` v1) or `gpg.format = openpgp` (standard OpenPGP packets with native Rust cryptography) without an external GPG daemon. OpenPGP requires the native runtime; the WebAssembly runtime returns an explicit unsupported-operation error.
- **SSH & Smart HTTP Transport**: Clone, fetch, pull, and push over `git@host:owner/repo.git`, `ssh://user@host:port/repo.git`, `https://`, and local paths with `~/.ssh/config` host aliases, `known_hosts` verification (`StrictHostKeyChecking`), and `authorized_keys` public-key authentication.
- **Client & Server Git Hooks**: Execute `pre-commit`, `prepare-commit-msg`, `commit-msg`, `post-commit`, `post-rewrite`, `post-checkout`, `post-merge`, `pre-rebase`, `pre-push`, and server-side `pre-receive`, `update`, and `post-receive` hooks with full `core.hooksPath` and `--no-verify` support.

## Feature Index Card

| Category | Supported Commands & Capabilities |
| --- | --- |
| **Porcelain & History** | `init`, `clone`, `add`, `mv`, `rm`, `restore`, `reset`, `status`, `commit`, `amend`, `log`, `show`, `diff`, `blame`, `shortlog`, `describe`, `reflog`, `bisect`, `grep` |
| **Branching & History Rewrite** | `branch`, `checkout`, `switch`, `merge`, `rebase` (`--onto`, `--abort`, `--continue`), `cherry-pick`, `revert`, `stash`, `tag`, `worktree`, `submodule`, `notes`, `replace` |
| **Signing & Verification** | `commit -S` / `--gpg-sign`, `tag -s` / `-u`, `verify-commit`, `verify-tag`, `log --show-signature`, `gpg.format = openpgp \| ssh`, `gpg.ssh.allowedSignersFile`, `gpg.openpgp.publicKeyFile` |
| **Network & Wire Transport** | `fetch`, `pull`, `push`, `remote`, `ls-remote`, `upload-pack`, `receive-pack`, `bundle`, `archive`, `format-patch`, `am`, `apply` |
| **Hooks Lifecycle** | `pre-commit`, `prepare-commit-msg`, `commit-msg`, `post-commit`, `post-rewrite`, `post-checkout`, `post-merge`, `pre-rebase`, `pre-push`, `pre-receive`, `update`, `post-receive` |

Branch deletion refuses the checked-out branch. Use `branch -d` for merged branches or `branch -D` to delete an unmerged branch.

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

### Signing and Verifying OpenPGP Signatures

Use an exported, unencrypted OpenPGP secret certificate as `user.signingkey`.
Encrypted secret keys return an error; an external GPG key ID does not import a
key from your host's GPG keyring. For external signatures, supply the signer's
exported certificate using `gpg.openpgp.publicKeyFile`:

```bash
git-rust config user.signingkey .git/signing-key.asc
git-rust config gpg.openpgp.publicKeyFile .git/signer-public.asc
git-rust commit -S -m "Signed commit"
git-rust verify-commit HEAD
```

The SDK exposes `pgp_sign_with_secret_key`, `pgp_public_key`, and
`pgp_verify_detached_with_key` through `git_rust::crypto`. Seed-based signatures
include a public certificate in a noncritical OpenPGP notation so verification
can run without a keyring. `pgp_public_key(seed, uid)` exports the certificate
for other OpenPGP implementations. A configured public certificate takes
precedence over the embedded certificate. Successful verification establishes
cryptographic validity and reports identity trust as unknown. Missing keys,
invalid signatures, and unsupported operations never report a good signature.

Signing requires a real secret certificate or SSH private key. Identity strings
and GPG key IDs never fabricate signing credentials.
