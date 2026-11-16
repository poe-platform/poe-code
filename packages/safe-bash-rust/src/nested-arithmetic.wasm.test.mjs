import assert from "node:assert/strict";
import test from "node:test";
import {RustWasmBash} from "./index.js";

// GNU Bash 5.3: recursive arithmetic retains the nested expression and radix.
const cases = [
{"source": "a=1; b=\"foo bar\"; ((a++, x = b)); printf \"a=%s rc=%s\\n\" \"$a\" \"$?\"", "stdout": "a=2 rc=1\n", "stderr": "shell: line 1: ((: foo bar: arithmetic syntax error in expression (error token is \"bar\")\n", "exitCode": 0},
{"source": "s=08; for ((i=0;s;i++)); do echo BAD; done; echo AFTER", "stdout": "AFTER\n", "stderr": "shell: line 1: ((: 08: value too great for base (error token is \"08\")\n", "exitCode": 0},
{"source": "s=08; for ((s++;0;)); do echo BAD; done; printf \"AFTER:%s\\n\" \"$s\"", "stdout": "AFTER:08\n", "stderr": "shell: line 1: ((: 08: value too great for base (error token is \"08\")\n", "exitCode": 0},
  {
    "source": "s=010; printf \"%s\\n\" \"$((s))\"",
    "stdout": "8\n",
    "stderr": "",
    "exitCode": 0
  },
  {
    "source": "s=-010; printf \"%s\\n\" \"$((s))\"",
    "stdout": "-8\n",
    "stderr": "",
    "exitCode": 0
  },
  {
    "source": "s=08; printf \"%s\\n\" \"$((s))\"",
    "stdout": "",
    "stderr": "shell: line 1: 08: value too great for base (error token is \"08\")\n",
    "exitCode": 1
  },
  {
    "source": "s=\"1 +\"; echo \"$((s))\"",
    "stdout": "",
    "stderr": "shell: line 1: 1 +: arithmetic syntax error: operand expected (error token is \"+\")\n",
    "exitCode": 1
  },
  {
    "source": "s=\"1 / 0\"; echo \"$((s))\"",
    "stdout": "",
    "stderr": "shell: line 1: 1 / 0: division by 0 (error token is \"0\")\n",
    "exitCode": 1
  },
  {
    "source": "a=b; b=08; echo \"$((a))\"",
    "stdout": "",
    "stderr": "shell: line 1: 08: value too great for base (error token is \"08\")\n",
    "exitCode": 1
  },
  {
    "source": "s=\"a=2, 1/0\"; a=0; ((s)); printf \"a=%s rc=%s\\n\" \"$a\" \"$?\"",
    "stdout": "a=2 rc=1\n",
    "stderr": "shell: line 1: ((: a=2, 1/0: division by 0 (error token is \"0\")\n",
    "exitCode": 0
  },
  {
    "source": "s='08'; for i in {1..3}; do s=$((s + i)); done",
    "stdout": "",
    "stderr": "shell: line 1: 08: value too great for base (error token is \"08\")\n",
    "exitCode": 1
  },
  {
    "source": "s='1 +'; for i in {1..3}; do s=$((s + i)); done",
    "stdout": "",
    "stderr": "shell: line 1: 1 +: arithmetic syntax error: operand expected (error token is \"+\")\n",
    "exitCode": 1
  },
  {
    "source": "s='08'; for ((i=0;i<3;i++)); do s=$((s + i)); done",
    "stdout": "",
    "stderr": "shell: line 1: 08: value too great for base (error token is \"08\")\n",
    "exitCode": 1
  },
  {
    "source": "s='1 +'; for ((i=0;i<3;i++)); do s=$((s + i)); done",
    "stdout": "",
    "stderr": "shell: line 1: 1 +: arithmetic syntax error: operand expected (error token is \"+\")\n",
    "exitCode": 1
  }
];
for (const runtime of ["TypeScript", "Rust"]) for (const entry of cases) {
  test(`${runtime} nested arithmetic: ${entry.source}`, {skip: !WebAssembly.Suspending}, async () => {
    const {Shell, createMemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
    const shell = runtime === "TypeScript" ? new Shell({fs:createMemoryFileSystem()}).use(agentCommands()) : new RustWasmBash({cwd:"/",forceNative:true});
    try {
      const r = await shell.exec(entry.source);
      assert.deepEqual({stdout:r.stdout,stderr:r.stderr,exitCode:r.exitCode},{stdout:entry.stdout,stderr:entry.stderr,exitCode:entry.exitCode});
      if (runtime === "Rust") assert.equal(shell._companion,null);
    } finally {await shell.dispose();}
  });
}
