import assert from "node:assert/strict";
import test from "node:test";
import {RustWasmBash} from "./index.js";

// GNU Bash 5.3: source reads the active descriptor, including shared offsets.
const cases = [
{"source": "source /dev/fd/4294967295; echo AFTER", "stdin": "", "stdout": "AFTER\n", "stderr": "shell: line 1: /dev/fd/4294967295: No such file or directory\n", "exitCode": 0},
{"source": "source /dev/fd/4294967296; echo AFTER", "stdin": "", "stdout": "AFTER\n", "stderr": "shell: line 1: /dev/fd/4294967296: No such file or directory\n", "exitCode": 0},
  {
    "source": "source /dev/stdin; echo AFTER",
    "stdin": "",
    "stdout": "AFTER\n",
    "stderr": "",
    "exitCode": 0
  },
  {
    "source": "source /dev/stdin; echo AFTER",
    "stdin": "echo input",
    "stdout": "input\nAFTER\n",
    "stderr": "",
    "exitCode": 0
  },
  {
    "source": ". /dev/fd/0; echo AFTER",
    "stdin": "echo input",
    "stdout": "input\nAFTER\n",
    "stderr": "",
    "exitCode": 0
  },
  {
    "source": "source /dev/fd/3 3<<<'echo descriptor'; echo AFTER",
    "stdin": "",
    "stdout": "descriptor\nAFTER\n",
    "stderr": "",
    "exitCode": 0
  },
  {
    "source": "exec 3<<<'echo descriptor'; source /dev/fd/3; source /dev/fd/3; echo AFTER",
    "stdin": "",
    "stdout": "descriptor\nAFTER\n",
    "stderr": "",
    "exitCode": 0
  },
  {
    "source": "source /dev/fd/9; echo AFTER",
    "stdin": "",
    "stdout": "AFTER\n",
    "stderr": "shell: line 1: /dev/fd/9: No such file or directory\n",
    "exitCode": 0
  },
  {
    "source": "source /dev/stdin 0<&-; echo AFTER",
    "stdin": "",
    "stdout": "AFTER\n",
    "stderr": "shell: line 1: /dev/stdin: No such file or directory\n",
    "exitCode": 0
  }
];
for (const runtime of ["TypeScript", "Rust"]) for (const entry of cases) {
  test(`${runtime} source descriptor: ${entry.source}, input ${JSON.stringify(entry.stdin)}`, {skip: !WebAssembly.Suspending}, async () => {
    const {Shell, createMemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
    const fs = createMemoryFileSystem();
    await fs.mkdir("/dev/fd", {recursive: true});
    for (const path of ["/dev/stdin", "/dev/fd/0", "/dev/fd/3", "/dev/fd/9", "/dev/fd/4294967295", "/dev/fd/4294967296"]) await fs.writeFile(path, new TextEncoder().encode("echo WRONG"));
    const shell = runtime === "TypeScript" ? new Shell({fs}).use(agentCommands()) : new RustWasmBash({fs, cwd: "/", forceNative: true});
    try {
      const r = await shell.exec(entry.source, {stdin: entry.stdin});
      assert.deepEqual({stdout:r.stdout,stderr:r.stderr,exitCode:r.exitCode},{stdout:entry.stdout,stderr:entry.stderr,exitCode:entry.exitCode});
      if (runtime === "Rust") assert.equal(shell._companion, null);
    } finally {await shell.dispose();}
  });
}
for (const runtime of ["TypeScript", "Rust"]) {
  test(`${runtime} sourced input retains its source-byte limit`, {skip: !WebAssembly.Suspending}, async () => {
    const {Shell, createMemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
    const shell = runtime === "TypeScript" ? new Shell({fs: createMemoryFileSystem()}).use(agentCommands())
      : new RustWasmBash({cwd: "/", forceNative: true});
    try {
      await assert.rejects(shell.exec("source /dev/stdin", {stdin: "#".repeat(128), limits: {maxSourceBytes: 64}}), {name: "ShellLimitError", limit: "maxSourceBytes"});
      if (runtime === "Rust") assert.equal(shell._companion, null);
    } finally {await shell.dispose();}
  });
}
