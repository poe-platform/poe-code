import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";

import { createStandardCommands } from "../../src/commands/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";

const conditions = [
  ["multi operator", 'a="1+1+1";', "$a -eq 3"],
  ["inequality", 'a="1+1+1";', "$a -ne 99"],
  ["hex", 'a="0x10";', "$a -eq 16"],
  ["base", 'a="2#101";', "$a -eq 5"],
  ["parentheses", 'a="(1+2)";', "$a -eq 3"],
  ["variable chain", "a=b; b=3;", "$a -eq 3"],
  ["less", 'a="1+1+1";', "$a -lt 4"],
  ["less equal", 'a="1+1+1";', "$a -le 3"],
  ["greater", 'a="1+1+1";', "$a -gt 2"],
  ["greater equal", 'a="1+1+1";', "$a -ge 3"],
  ["device", "", "-e /dev/null"],
  ...["-f", "-d", "-s", "-L", "-h"].map(op => [op, "", `! ${op} /dev/null`] as const),
  ["collation differs from byte order", "LC_ALL=en_US.UTF-8;", "ä < z"],
  ["locale override", "LANG=en_US.UTF-8; LC_ALL=C;", "Z < a"],
  ["conjunction", 'a="1+1+1";', "$a -eq 3 && -e /dev/null"],
  ["disjunction", 'a="1+1+1";', "-e /dev/nonexistent || $a -eq 3"],
  ["missing device", "", "! -e /dev/nonexistent"],
  ["locale less", "LANG=en_US.UTF-8;", "a < b"],
  ["locale greater", "LC_COLLATE=en_US.UTF-8;", "b > a"],
  ["locale negated", "LANG=en_US.UTF-8;", "! b < a"],
  ["non ascii", "", "é < Ω"],
] as const;

for (const [name, setup, condition] of conditions) {
  const sources = [
    `for i in 1 2; do if [[ ${condition} ]]; then echo yes; else echo no; fi; done`,
    `for i in 1 2; do echo "$(if [[ ${condition} ]]; then echo yes; else echo no; fi)"; done`,
    `for i in 1 2; do x=$(if [[ ${condition} ]]; then echo yes; else echo no; fi); echo "$x"; done`,
    `i=0; while [[ ${condition} ]]; do echo yes; ((i++)); if (( i == 2 )); then break; fi; done; :`,
    `i=0; while [[ ${condition} ]] && (( i < 2 )); do echo yes; ((i++)); done; :`,
  ];
  for (const [index, source] of sources.entries()) {
    test(`${name}: context ${index}`, async () => {
      const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(createStandardCommands()) });
      try {
        const result = await shell.exec(setup + source);
        assert.equal(result.stdout, "yes\nyes\n");
        assert.equal(result.stderr, "");
        assert.equal(result.exitCode, 0);
      } finally { await shell.dispose(); }
    });
  }
}

for (const operator of ["-r", "-w", "-x"]) {
  test(`${operator}: device permissions retain the unsupported-profile diagnostic`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(createStandardCommands()) });
    try {
      const result = await shell.exec(`for i in 1 2; do [[ ${operator} /dev/null ]]; echo $?; done`);
      assert.equal(result.stdout, "2\n2\n");
      assert.equal(result.stderr.split("unobservable access permission").length - 1, 2);
    } finally { await shell.dispose(); }
  });
}
