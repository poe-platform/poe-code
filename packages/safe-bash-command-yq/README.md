# YAML and TOML queries

Safe Bash includes a bounded YAML/TOML query profile and an optional Mike-yq
profile with document, comment, alias and in-place editing support. Both execute
against the shell's virtual filesystem and retain their existing byte and work
limits. The optional profile requires the optional `yaml@2.9.0` peer.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { yqCommands } from "@poe-platform/safe-bash/commands/yq";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(yqCommands());
await shell.exec("printf 'name: example\\n' | yq '.name'");
```

Use `@poe-platform/safe-bash/yq` for the optional Mike-yq profile. Register one profile
at a time, or explicitly request replacement under the shell registry's existing
collision policy. This workspace is internal; its implementation ships through
the established Safe Bash exports.
