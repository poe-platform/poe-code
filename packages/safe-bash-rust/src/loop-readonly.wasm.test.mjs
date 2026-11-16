import assert from "node:assert/strict";
import test from "node:test";
import {RustWasmBash} from "./index.js";

// GNU Bash 5.3 results, including reuse after a variable becomes readonly.
const cases = [
  ["readonly n=7; ((n+=1)); printf \"status=%s n=%s\\n\" \"$?\" \"$n\"", "status=1 n=7\n", "shell: line 1: n: readonly variable\n", 0],
  ["readonly n=7; for ((n=0;0;)); do echo BAD; done; printf \"status=%s n=%s\\n\" \"$?\" \"$n\"", "status=1 n=7\n", "shell: line 1: n: readonly variable\n", 0],
  ["readonly n=7; for ((;n=0;)); do echo BAD; done; printf \"status=%s n=%s\\n\" \"$?\" \"$n\"", "status=1 n=7\n", "shell: line 1: n: readonly variable\n", 0],
  ["readonly n=7; for ((i=0;i<1;n++)); do ((i++)); done; printf \"status=%s n=%s\\n\" \"$?\" \"$n\"", "status=1 n=7\n", "shell: line 1: n: readonly variable\n", 0],
  ["((1/0)); echo AFTER", "AFTER\n", "shell: line 1: ((: 1/0: division by 0 (error token is \"0\")\n", 0],
  ["for ((i=1/0;0;)); do echo BAD; done; echo AFTER", "AFTER\n", "shell: line 1: ((: i=1/0: division by 0 (error token is \"0\")\n", 0],
  [
    "readonly i=old; for i in 1 2; do echo BAD; done; echo AFTER",
    "AFTER\n",
    "shell: line 1: i: readonly variable\n",
    0
  ],
  [
    "readonly n=7; for i in 1 2; do n=8; done; echo AFTER",
    "",
    "shell: line 1: n: readonly variable\n",
    1
  ],
  [
    "readonly n=7; for i in 1 2; do ((n+=1)); done; echo AFTER",
    "AFTER\n",
    "shell: line 1: n: readonly variable\nshell: line 1: n: readonly variable\n",
    0
  ],
  [
    "f() { for i in 1 2; do ((n+=1)); done; }; n=0; f; printf \"before:%s|\" \"$n\"; readonly n; f; printf \"after:%s\" \"$n\"",
    "before:2|after:2",
    "shell: line 1: n: readonly variable\nshell: line 1: n: readonly variable\n",
    0
  ],
  [
    "x=\"*\"; n=0; for i in {1..2}; do case $x in \"*\") ((n+=10));; \"a\"|\"b\") ((n+=1));; esac; done; echo \"$n\"",
    "20\n",
    "",
    0
  ]
];
for (const runtime of ["TypeScript", "Rust"]) for (const [source, stdout, stderr, exitCode] of cases) {
  test(`${runtime} loop readonly behavior: ${source}`, {skip: !WebAssembly.Suspending}, async () => {
    const {Shell, createMemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
    const shell = runtime === "TypeScript" ? new Shell({fs: createMemoryFileSystem()}).use(agentCommands())
      : new RustWasmBash({cwd: "/", forceNative: true});
    try {
      const result = await shell.exec(source);
      assert.equal(result.stdout, stdout);
      assert.equal(result.stderr, stderr);
      assert.equal(result.exitCode, exitCode);
      if (runtime === "Rust") assert.equal(shell._companion, null);
    } finally {await shell.dispose();}
  });
}
