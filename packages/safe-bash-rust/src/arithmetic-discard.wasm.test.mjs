import assert from "node:assert/strict";
import test from "node:test";
import {RustWasmBash} from "./index.js";
import {trapExtension} from "../../safe-bash/dist/shell/extensions/trap/index.js";

// GNU Bash 5.3, with nested bash resolved to the same version.
const cases = [
  {
    "name": "top-list",
    "source": "s=08; echo \"$((s))\"; printf skipped\nprintf \"after=%s\" \"$?\"",
    "stdin": "",
    "stdout": "after=1",
    "stderr": "shell: line 1: 08: value too great for base (error token is \"08\")\n",
    "exitCode": 0
  },
  {
    "name": "group",
    "source": "{ s=08; echo \"$((s))\"; printf skipped\nprintf inner; }; printf skipped\nprintf \"after=%s\" \"$?\"",
    "stdin": "",
    "stdout": "after=1",
    "stderr": "shell: line 1: 08: value too great for base (error token is \"08\")\n",
    "exitCode": 0
  },
  {
    "name": "function",
    "source": "f() { s=08; echo \"$((s))\"; printf skipped\nprintf inner; }; f; printf skipped\nprintf \"after=%s\" \"$?\"",
    "stdin": "",
    "stdout": "after=1",
    "stderr": "shell: line 1: 08: value too great for base (error token is \"08\")\n",
    "exitCode": 0
  },
  {
    "name": "for",
    "source": "s=08; count=0\nfor i in {1..3}; do\n count=$((count+1))\n echo \"before:$count\"\n s=$((s + i))\n echo unreachable\ndone\necho after",
    "stdin": "",
    "stdout": "before:1\nafter\n",
    "stderr": "shell: line 5: 08: value too great for base (error token is \"08\")\n",
    "exitCode": 0
  },
  {
    "name": "arithmetic-for",
    "source": "s=08; for ((i=0;i<3;i++)); do echo before; s=$((s+i)); echo unreachable; done; echo skipped\necho after",
    "stdin": "",
    "stdout": "before\nafter\n",
    "stderr": "shell: line 1: 08: value too great for base (error token is \"08\")\n",
    "exitCode": 0
  },
  {
    "name": "subshell",
    "source": "(s=08; echo \"$((s))\"; printf skipped\nprintf inner); printf \"outer=%s\" \"$?\"",
    "stdin": "",
    "stdout": "outer=1",
    "stderr": "shell: line 1: 08: value too great for base (error token is \"08\")\n",
    "exitCode": 0
  },
  {
    "name": "substitution",
    "source": "text=$(s=08; echo \"$((s))\"; printf skipped\nprintf inner); printf \"outer=%s:<%s>\" \"$?\" \"$text\"",
    "stdin": "",
    "stdout": "outer=1:<>",
    "stderr": "shell: line 2: 08: value too great for base (error token is \"08\")\n",
    "exitCode": 0
  },
  {
    "name": "eval",
    "source": "eval 's=08; echo \"$((s))\"; printf skipped\nprintf \"inner=%s\" \"$?\"'; printf outer",
    "stdin": "",
    "stdout": "inner=1outer",
    "stderr": "shell: line 1: 08: value too great for base (error token is \"08\")\n",
    "exitCode": 0
  },
  {
    "name": "source",
    "source": "source /dev/stdin; printf outer",
    "stdin": "s=08; echo \"$((s))\"; printf skipped\nprintf \"inner=%s\" \"$?\"",
    "stdout": "inner=1outer",
    "stderr": "/dev/stdin: line 1: 08: value too great for base (error token is \"08\")\n",
    "exitCode": 0
  },
  {
    "name": "script",
    "source": "bash /dev/stdin; printf \"outer=%s\" \"$?\"",
    "stdin": "s=08; echo \"$((s))\"; printf skipped\nprintf \"inner=%s\" \"$?\"",
    "stdout": "inner=1outer=0",
    "stderr": "/dev/stdin: line 1: 08: value too great for base (error token is \"08\")\n",
    "exitCode": 0
  },
  {
    "name": "errexit",
    "source": "set -e; s=08; echo \"$((s))\"; printf skipped\nprintf \"after=%s\" \"$?\"",
    "stdin": "",
    "stdout": "after=1",
    "stderr": "shell: line 1: 08: value too great for base (error token is \"08\")\n",
    "exitCode": 0
  },
  {
    "name": "exit-trap",
    "source": "trap 'printf \"<exit:%s>\" \"$?\"' EXIT; s=08; echo \"$((s))\"; printf skipped\nprintf after",
    "stdin": "",
    "stdout": "after<exit:0>",
    "stderr": "shell: line 1: 08: value too great for base (error token is \"08\")\n",
    "exitCode": 0
  },
  {
    "name": "mutation",
    "source": "a=0; s=\"a=2, 1/0\"; echo \"$((s))\"; echo skipped\nprintf \"after=%s:%s\" \"$?\" \"$a\"",
    "stdin": "",
    "stdout": "after=1:2",
    "stderr": "shell: line 1: a=2, 1/0: division by 0 (error token is \"0\")\n",
    "exitCode": 0
  },
  {
    "name": "nounset-control",
    "source": "(set -u; echo \"$missing\"; printf skipped\nprintf skipped); printf \"outer=%s\" \"$?\"",
    "stdin": "",
    "stdout": "outer=1",
    "stderr": "shell: line 1: missing: unbound variable\n",
    "exitCode": 0
  },
  {
    "name": "parameter-control",
    "source": "echo \"${missing:?required}\"; printf skipped\nprintf skipped",
    "stdin": "",
    "stdout": "",
    "stderr": "shell: line 1: missing: required\n",
    "exitCode": 127
  },
  {
    "name": "explicit-exit",
    "source": "exit 7; printf skipped\nprintf skipped",
    "stdin": "",
    "stdout": "",
    "stderr": "",
    "exitCode": 7
  },
  {
    "name": "readonly-expansion",
    "source": "readonly n=0; echo \"$((n=2))\"; printf skipped\nprintf \"after=%s:%s\" \"$?\" \"$n\"",
    "stdin": "",
    "stdout": "after=1:0",
    "stderr": "shell: line 1: n: readonly variable\n",
    "exitCode": 0
  },
  {
    "name": "readonly-assignment-expansion",
    "source": "readonly n=0; value=$((n=2)); printf skipped\nprintf \"after=%s:%s\" \"$?\" \"$n\"",
    "stdin": "",
    "stdout": "after=1:0",
    "stderr": "shell: line 1: n: readonly variable\n",
    "exitCode": 0
  },
  {
    "name": "here-string-control",
    "source": "cat <<< \"$((1/0))\"; printf \"same=%s;\" \"$?\"\nprintf after",
    "stdin": "",
    "stdout": "same=1;after",
    "stderr": "shell: line 1: 1/0: division by 0 (error token is \"0\")\n",
    "exitCode": 0
  },
  {
    "name": "here-document-control",
    "source": "cat <<EOF\n$((1/0))\nEOF\nprintf after",
    "stdin": "",
    "stdout": "after",
    "stderr": "shell: line 1: 1/0: division by 0 (error token is \"0\")\n",
    "exitCode": 0
  },
  {
    "name": "arithmetic-nounset-control",
    "source": "(set -u; echo \"$((missing))\"; printf skipped\nprintf skipped); printf \"outer=%s\" \"$?\"",
    "stdin": "",
    "stdout": "outer=1",
    "stderr": "shell: line 1: missing: unbound variable\n",
    "exitCode": 0
  },
  {
    "name": "redirect-expansion",
    "source": ": > \"$((1/0))\"; printf skipped\nprintf after",
    "stdin": "",
    "stdout": "after",
    "stderr": "shell: line 1: 1/0: division by 0 (error token is \"0\")\n",
    "exitCode": 0
  },
  {
    "name": "substitution-eval",
    "source": "text=$(eval 'echo \"$((1/0))\"; printf skipped\nprintf skipped'; printf skipped); printf '<%s>' \"$text\"",
    "stdin": "",
    "stdout": "<>",
    "stderr": "shell: line 2: 1/0: division by 0 (error token is \"0\")\n",
    "exitCode": 0
  }
];
for (const runtime of ["TypeScript", "Rust"]) for (const middleware of [false, true]) for (const entry of cases) {
  test(`${runtime} arithmetic expansion recovery${middleware ? " through middleware" : ""}: ${entry.name}`, {skip: !WebAssembly.Suspending}, async () => {
    const {Shell,createMemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
    const fs=createMemoryFileSystem();
    if (entry.stdin) {
      await fs.mkdir("/dev");
      await fs.writeFile("/dev/stdin",new TextEncoder().encode(entry.stdin));
    }
    const extensions=entry.name === "exit-trap" ? [trapExtension()] : [];
    const shell=runtime === "TypeScript" ? new Shell({fs,extensions}).use(agentCommands()) : new RustWasmBash({fs,cwd:"/",forceNative:true});
    if (middleware) shell.use((_context,next)=>next());
    try {
      const r=await shell.exec(entry.source,{stdin:entry.stdin,env:{LC_ALL:"C"}});
      assert.deepEqual([r.stdout,r.stderr,r.exitCode],[entry.stdout,entry.stderr,entry.exitCode]);
      if (runtime === "Rust") assert.equal(shell._companion,null);
    } finally {await shell.dispose();}
  });
}
