import assert from "node:assert/strict";
import test from "node:test";
import {RustWasmBash} from "./index.js";
import {arraysExtension} from "../../safe-bash/dist/shell/extensions/arrays/index.js";
import {readExtension} from "../../safe-bash/dist/shell/extensions/read/index.js";
import {trapExtension} from "../../safe-bash/dist/shell/extensions/trap/index.js";

// GNU Bash 5.3, including child bash and sh invocations of that same version.
// TypeScript uses its maintained indexed-declaration extension profile.
const cases = [
  {
    "name": "top-list",
    "source": "readonly -a values=(one); readonly -a values=(two); printf skipped\nprintf \"after=%s:%s\" \"$?\" \"$values\"",
    "stdin": "",
    "stdout": "after=1:one",
    "stderr": "shell: line 1: values: readonly variable\n",
    "exitCode": 0
  },
  {
    "name": "group",
    "source": "readonly -a values=(one); { readonly -a values=(two); printf skipped\nprintf inner; }; printf outer\nprintf \"after=%s:%s\" \"$?\" \"$values\"",
    "stdin": "",
    "stdout": "after=1:one",
    "stderr": "shell: line 1: values: readonly variable\n",
    "exitCode": 0
  },
  {
    "name": "function",
    "source": "readonly -a values=(one); f() { readonly -a values=(two); printf skipped\nprintf inner; }; f; printf outer\nprintf \"after=%s:%s\" \"$?\" \"$values\"",
    "stdin": "",
    "stdout": "after=1:one",
    "stderr": "shell: line 1: f: values: readonly variable\n",
    "exitCode": 0
  },
  {
    "name": "if",
    "source": "readonly -a values=(one); if true; then readonly -a values=(two); printf skipped\nprintf inner; fi; printf outer\nprintf \"after=%s:%s\" \"$?\" \"$values\"",
    "stdin": "",
    "stdout": "after=1:one",
    "stderr": "shell: line 1: values: readonly variable\n",
    "exitCode": 0
  },
  {
    "name": "subshell",
    "source": "readonly -a values=(one); (readonly -a values=(two); printf skipped\nprintf inner); printf \"outer=%s;\" \"$?\"\nprintf \"after=%s:%s\" \"$?\" \"$values\"",
    "stdin": "",
    "stdout": "outer=1;after=0:one",
    "stderr": "shell: line 1: values: readonly variable\n",
    "exitCode": 0
  },
  {
    "name": "substitution",
    "source": "readonly -a values=(one); text=$(readonly -a values=(two); printf skipped\nprintf inner); printf \"outer=%s:<%s>;\" \"$?\" \"$text\"\nprintf \"after=%s:%s\" \"$?\" \"$values\"",
    "stdin": "",
    "stdout": "outer=1:<>;after=0:one",
    "stderr": "shell: line 2: values: readonly variable\n",
    "exitCode": 0
  },
  {
    "name": "eval",
    "source": "readonly -a values=(one); eval 'readonly -a values=(two); printf skipped\nprintf \"inner=%s:%s;\" \"$?\" \"$values\"'; printf outer\nprintf \"after=%s:%s\" \"$?\" \"$values\"",
    "stdin": "",
    "stdout": "inner=1:one;outerafter=0:one",
    "stderr": "shell: line 1: eval: values: readonly variable\n",
    "exitCode": 0
  },
  {
    "name": "source",
    "source": "source /dev/stdin; printf outer\nprintf \"after=%s:%s\" \"$?\" \"$values\"",
    "stdin": "readonly -a values=(one); readonly -a values=(two); printf skipped\nprintf \"inner=%s:%s;\" \"$?\" \"$values\"",
    "stdout": "inner=1:one;outerafter=0:one",
    "stderr": "/dev/stdin: line 1: values: readonly variable\n",
    "exitCode": 0
  },
  {
    "name": "script",
    "source": "bash /dev/stdin; printf \"outer=%s;\" \"$?\"\nprintf after",
    "stdin": "readonly -a values=(one); readonly -a values=(two); printf skipped\nprintf \"inner=%s:%s;\" \"$?\" \"$values\"",
    "stdout": "inner=1:one;outer=0;after",
    "stderr": "/dev/stdin: line 1: values: readonly variable\n",
    "exitCode": 0
  },
  {
    "name": "and-or",
    "source": "readonly -a values=(one); readonly -a values=(two) || printf recovered; printf skipped\nprintf \"after=%s:%s\" \"$?\" \"$values\"",
    "stdin": "",
    "stdout": "after=1:one",
    "stderr": "shell: line 1: values: readonly variable\n",
    "exitCode": 0
  },
  {
    "name": "pipeline",
    "source": "readonly -a values=(one); { readonly -a values=(two); printf skipped\nprintf inner; } | while IFS= read -r line; do printf \"%s\" \"$line\"; done; printf \"outer=%s;\" \"$?\"\nprintf after",
    "stdin": "",
    "stdout": "outer=0;after",
    "stderr": "shell: line 1: values: readonly variable\n",
    "exitCode": 0
  },
  {
    "name": "errexit",
    "source": "set -e; readonly -a values=(one); readonly -a values=(two); printf skipped\nprintf \"after=%s\" \"$?\"",
    "stdin": "",
    "stdout": "after=1",
    "stderr": "shell: line 1: values: readonly variable\n",
    "exitCode": 0
  },
  {
    "name": "exit-trap",
    "source": "trap 'printf \"<exit:%s>\" \"$?\"' EXIT; readonly -a values=(one); readonly -a values=(two); printf skipped\nprintf after",
    "stdin": "",
    "stdout": "after<exit:0>",
    "stderr": "shell: line 1: values: readonly variable\n",
    "exitCode": 0
  },
  {
    "name": "function-locals",
    "source": "values=outer; f() { local -a values; readonly -a values=(one); readonly -a values=(two); printf skipped; }; f; printf skipped\nvalues=restored; printf \"%s:%s\" \"$?\" \"$values\"",
    "stdin": "",
    "stdout": "0:restored",
    "stderr": "shell: line 1: values: readonly variable\n",
    "exitCode": 0
  },
  {
    "name": "function-source",
    "source": "f() { source /dev/stdin; printf outer; }; f; printf after",
    "stdin": "readonly -a values=(one); readonly -a values=(two); printf skipped\nprintf \"inner=%s:%s;\" \"$?\" \"$values\"",
    "stdout": "inner=1:one;outerafter",
    "stderr": "/dev/stdin: line 1: values: readonly variable\n",
    "exitCode": 0
  },
  {
    "name": "eval-source",
    "source": "eval 'source /dev/stdin; printf outer'; printf after",
    "stdin": "readonly -a values=(one); readonly -a values=(two); printf skipped\nprintf \"inner=%s:%s;\" \"$?\" \"$values\"",
    "stdout": "inner=1:one;outerafter",
    "stderr": "/dev/stdin: line 1: values: readonly variable\n",
    "exitCode": 0
  },
  {
    "name": "function-script",
    "source": "f() { bash /dev/stdin; printf outer; }; f; printf after",
    "stdin": "readonly -a values=(one); readonly -a values=(two); printf skipped\nprintf \"inner=%s:%s;\" \"$?\" \"$values\"",
    "stdout": "inner=1:one;outerafter",
    "stderr": "/dev/stdin: line 1: values: readonly variable\n",
    "exitCode": 0
  },
  {
    "name": "sh-script",
    "source": "sh /dev/stdin; printf \"outer=%s;\" \"$?\"\nprintf after",
    "stdin": "readonly -a values=(one); readonly -a values=(two); printf skipped\nprintf \"inner=%s:%s;\" \"$?\" \"$values\"",
    "stdout": "inner=1:one;outer=0;after",
    "stderr": "/dev/stdin: line 1: values: readonly variable\n",
    "exitCode": 0
  },
  {
    "name": "standard-input-script",
    "source": "bash -s; printf \"outer=%s;\" \"$?\"\nprintf after",
    "stdin": "readonly -a values=(one); readonly -a values=(two); printf skipped\nprintf \"inner=%s:%s;\" \"$?\" \"$values\"",
    "stdout": "inner=1:one;outer=0;after",
    "stderr": "bash: line 1: values: readonly variable\n",
    "exitCode": 0
  },
  {
    "name": "previous-unit-function",
    "source": "readonly -a values=(one)\nf() { readonly -a values=(two); printf skipped; }\nf; printf skipped\nprintf \"after=%s:%s\" \"$?\" \"$values\"",
    "stdin": "",
    "stdout": "after=1:one",
    "stderr": "shell: line 2: f: values: readonly variable\n",
    "exitCode": 0
  },
  {
    "name": "substitution-eval",
    "source": "readonly -a values=(one); text=$(eval 'readonly -a values=(two); printf skipped\nprintf \"inner=%s;\" \"$?\"'; printf outer); printf '<%s>' \"$text\"",
    "stdin": "",
    "stdout": "<>",
    "stderr": "shell: line 2: eval: values: readonly variable\n",
    "exitCode": 0
  },
  {
    "name": "function-exit-trap",
    "source": "trap 'printf \"<exit:%s>\" \"$?\"' EXIT; readonly -a values=(one); f() { readonly -a values=(two); printf skipped; }; f; printf skipped\nprintf after",
    "stdin": "",
    "stdout": "after<exit:0>",
    "stderr": "shell: line 1: f: values: readonly variable\n",
    "exitCode": 0
  },
  {
    "name": "same-line",
    "source": "readonly -a values=(one); readonly -a values=(two); printf skipped",
    "stdin": "",
    "stdout": "",
    "stderr": "shell: line 1: values: readonly variable\n",
    "exitCode": 1
  },
  {
    "name": "scalar-control",
    "source": "readonly value=one; readonly value=two; printf \"after=%s:%s\" \"$?\" \"$value\"",
    "stdin": "",
    "stdout": "after=1:one",
    "stderr": "shell: line 1: value: readonly variable\n",
    "exitCode": 0
  },
  {
    "name": "scalar-errexit-control",
    "source": "set -e; readonly value=one; readonly value=two; printf skipped\nprintf skipped",
    "stdin": "",
    "stdout": "",
    "stderr": "shell: line 1: value: readonly variable\n",
    "exitCode": 1
  },
  {
    "name": "explicit-exit-control",
    "source": "exit 7; printf skipped\nprintf skipped",
    "stdin": "",
    "stdout": "",
    "stderr": "",
    "exitCode": 7
  },
  {
    "name": "readonly-append",
    "source": "readonly -a values=(one); readonly -a values+=(two); printf skipped\nprintf \"after=%s:%s\" \"$?\" \"$values\"",
    "stdin": "",
    "stdout": "after=1:one",
    "stderr": "shell: line 1: values: readonly variable\n",
    "exitCode": 0
  },
  {
    "name": "substitution-source",
    "source": "text=$(source /dev/stdin; printf outer); printf \"<%s>\" \"$text\"",
    "stdin": "readonly -a values=(one); readonly -a values=(two); printf skipped\nprintf inner",
    "stdout": "<>",
    "stderr": "/dev/stdin: line 1: values: readonly variable\n",
    "exitCode": 0
  },
  {
    "name": "substitution-child-script",
    "source": "text=$(bash /dev/stdin; printf outer); printf \"<%s>\" \"$text\"",
    "stdin": "readonly -a values=(one); readonly -a values=(two); printf skipped\nprintf inner",
    "stdout": "<innerouter>",
    "stderr": "/dev/stdin: line 1: values: readonly variable\n",
    "exitCode": 0
  },
  {
    "name": "subshell-variable-control",
    "source": "BASH_SUBSHELL=9; readonly -a values=(one); readonly -a values=(two); printf skipped\nprintf after",
    "stdin": "",
    "stdout": "after",
    "stderr": "shell: line 1: values: readonly variable\n",
    "exitCode": 0
  },
  {
    "name": "substitution-variable-control",
    "source": "readonly -a values=(one); text=$(BASH_SUBSHELL=0; eval 'readonly -a values=(two); printf skipped\nprintf inner'; printf outer); printf '<%s>' \"$text\"",
    "stdin": "",
    "stdout": "<>",
    "stderr": "shell: line 2: eval: values: readonly variable\n",
    "exitCode": 0
  }
];
for (const runtime of ["TypeScript", "Rust"]) for (const middleware of [false, true]) for (const entry of cases) {
  test(`${runtime} readonly declaration discard${middleware ? " through middleware" : ""}: ${entry.name}`, {skip: !WebAssembly.Suspending}, async () => {
    const {Shell,createMemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
    const fs=createMemoryFileSystem();
    if (entry.stdin && entry.name !== "standard-input-script") {
      await fs.mkdir("/dev");
      await fs.writeFile("/dev/stdin",new TextEncoder().encode(entry.stdin));
    }
    const extensions=[arraysExtension()];
    if (entry.name === "pipeline") extensions.push(readExtension());
    if (entry.name.includes("exit-trap")) extensions.push(trapExtension());
    const shell=runtime === "TypeScript" ? new Shell({fs,extensions}).use(agentCommands()) : new RustWasmBash({fs,cwd:"/",forceNative:true});
    if (middleware) shell.use((_context, next) => next());
    try {
      const r=await shell.exec(entry.source,{stdin:entry.stdin,env:{LC_ALL:"C"}});
      assert.deepEqual({stdout:r.stdout,stderr:r.stderr,exitCode:r.exitCode},{stdout:entry.stdout,stderr:entry.stderr,exitCode:entry.exitCode});
      if (runtime === "Rust") assert.equal(shell._companion,null);
    } finally {await shell.dispose();}
  });
}
