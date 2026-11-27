# Grep for Safe Bash

Search virtual files and pipelines with basic, extended, or fixed patterns,
recursive include/exclude selection, context lines, and explicit resource limits.
Searches skip input containing NUL or invalid UTF-8 bytes by default, so binary
files do not abort recursive searches. Use `-a` or `--binary-files=text` to
treat those bytes as text within the selected regex executor's limits.
`grep -P` also supports `\K` match-start resets, `\xHH` hexadecimal characters,
and `\Q...\E` literal quoting (for example, `grep -oP 'version: \K.*'`).
`grep -P` supports positive and negative lookahead and fixed-length lookbehind,
for example `grep -oP '(?<=id=")[^"]+'`. Variable-length lookbehind and
backreferences are unsupported.
Basic and extended patterns accept UTF-8 literals, including accents, CJK and emoji;
matching preserves original output bytes. Case folding and word boundaries use ASCII rules.
Regex searches skip files containing NUL or invalid UTF-8 subjects and continue searching
the remaining files; use `-a` to explicitly search binary input as text.
`egrep` and `fgrep` select extended and fixed matching; `rgrep` enables recursive search (`grep -r`).

```ts
import { Shell, agentCommands, createMemoryFileSystem } from "@poe-platform/safe-bash";

const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
try {
  const result = await shell.exec("printf 'alpha\\nbeta\\n' | grep -n alpha");
  console.log(result.stdout); // 1:alpha
} finally {
  await shell.dispose();
}
```

This private workspace is bundled into Safe Bash. Consumers install and import
only the public Safe Bash package; no separate grep package is required.
