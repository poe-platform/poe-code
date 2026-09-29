# safe-bash-command-ssh

OpenSSH client (`ssh`) and key/signature utility (`ssh-keygen`) commands for `@poe-platform/safe-bash`.

## Features

- **`ssh-keygen`**:
  - Generate `openssh-key-v1` Ed25519 private and public key pairs (`ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -C "user@host"`).
  - Derive public keys from private keys (`ssh-keygen -y -f ~/.ssh/id_ed25519`).
  - Display `SHA256:` key fingerprints (`ssh-keygen -l -f ~/.ssh/id_ed25519.pub`).
  - Search (`-F`) and remove (`-R`) hosts in `known_hosts`.
  - Create and verify `SSHSIG` v1 signatures (`ssh-keygen -Y sign`, `ssh-keygen -Y verify`, `ssh-keygen -Y check-novalidate`, `ssh-keygen -Y find-principals`) compatible with Git `gpg.format = ssh`.
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
