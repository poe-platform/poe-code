# safe-bash-command-ssh

OpenSSH client (`ssh`) and key/signature utility (`ssh-keygen`) commands for `@poe-platform/safe-bash`.

## Features

- **`ssh-keygen`**:
  - Generate an unencrypted Ed25519 key pair (`ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519 -C "user@host"`). The private file is created with mode `0600`. Use a new path for each pair; existing files and nonempty passphrases are rejected.
  - Derive public keys from private keys (`ssh-keygen -y -f ~/.ssh/id_ed25519`).
  - Display `SHA256:` key fingerprints (`ssh-keygen -l -f ~/.ssh/id_ed25519.pub`).
  - Search `known_hosts` with `-F`, including hashed hosts, wildcard patterns, revoked keys, and certificate authorities. Use `-q` for the matching records alone or `-l` for Ed25519 fingerprints. Remove matching unmarked records with `-R`; the original file is kept as `.old`.
  - Create and verify `SSHSIG` v1 signatures (`ssh-keygen -Y sign`, `ssh-keygen -Y verify`, `ssh-keygen -Y check-novalidate`, `ssh-keygen -Y find-principals`) compatible with Git `gpg.format = ssh`. Verification requires `-f <allowed_signers>`, `-I <identity>`, and `-n <namespace>`; signer entries support comma-separated principal patterns (`*`, `?`, and negation) and `namespaces="..."`. Comment lines are ignored. Unsupported signer options are rejected.
- **`ssh`**:
  - Parse `~/.ssh/config`, verify `known_hosts` and identity keys, and execute `-G` config dumps or remote repository commands (`git-upload-pack`, `git-receive-pack`).

## Usage

```ts
import { Shell, createMemoryFileSystem, sshCommands } from "@poe-platform/safe-bash";

const fs = createMemoryFileSystem();
const shell = new Shell({ fs }).use(sshCommands());

await shell.exec('ssh-keygen -t ed25519 -f /home/user/.ssh/id_ed25519 -C "alice@example.com" -N ""');
await shell.exec("ssh-keygen -l -f /home/user/.ssh/id_ed25519.pub");
```
