import assert from "node:assert/strict";
import test from "node:test";
import {RustWasmBash} from "./index.js";

// GNU Bash 5.3 controls with a source file containing break or continue.
const cases = [
  {
    "name": "break caller loop",
    "source": "f() { break; echo helper; }; for i in 1 2; do f; echo item:$i; done; echo end",
    "control": "break",
    "stdout": "helper\nitem:1\nhelper\nitem:2\nend\n",
    "stderr": "shell: line 1: break: only meaningful in a `for', `while', or `until' loop\nshell: line 1: break: only meaningful in a `for', `while', or `until' loop\n",
    "exitCode": 0
  },
  {
    "name": "break nested function",
    "source": "f() { g() { break; echo helper; }; g; }; for i in 1 2; do f; echo item:$i; done; echo end",
    "control": "break",
    "stdout": "helper\nitem:1\nhelper\nitem:2\nend\n",
    "stderr": "shell: line 1: break: only meaningful in a `for', `while', or `until' loop\nshell: line 1: break: only meaningful in a `for', `while', or `until' loop\n",
    "exitCode": 0
  },
  {
    "name": "break local loop",
    "source": "f() { for j in a b; do echo inner:$j; break; echo unreachable; done; echo helper; }; for i in 1 2; do f; echo item:$i; done; echo end",
    "control": "break",
    "stdout": "inner:a\nhelper\nitem:1\ninner:a\nhelper\nitem:2\nend\n",
    "stderr": "",
    "exitCode": 0
  },
  {
    "name": "break local loop count",
    "source": "f() { for j in a b; do echo inner:$j; break 2; echo unreachable; done; echo helper; }; for i in 1 2; do f; echo item:$i; done; echo end",
    "control": "break",
    "stdout": "inner:a\nhelper\nitem:1\ninner:a\nhelper\nitem:2\nend\n",
    "stderr": "",
    "exitCode": 0
  },
  {
    "name": "break resumed function",
    "source": "f() { v='a b'; for j in a b; do echo inner:$j; break; done; echo $v; echo helper; }; for i in 1 2; do f; echo item:$i; done; echo end",
    "control": "break",
    "stdout": "inner:a\na b\nhelper\nitem:1\ninner:a\na b\nhelper\nitem:2\nend\n",
    "stderr": "",
    "exitCode": 0
  },
  {
    "name": "break return restores caller loop",
    "source": "f() { return 7; }; for i in 1 2; do f; echo status:$?; break; echo item:$i; done; echo end",
    "control": "break",
    "stdout": "status:7\nend\n",
    "stderr": "",
    "exitCode": 0
  },
  {
    "name": "break source inside function",
    "source": "f() { . /control; echo helper; }; for i in 1 2; do f; echo item:$i; done; echo end",
    "control": "break",
    "stdout": "helper\nitem:1\nhelper\nitem:2\nend\n",
    "stderr": "/control: line 1: break: only meaningful in a `for', `while', or `until' loop\n/control: line 1: break: only meaningful in a `for', `while', or `until' loop\n",
    "exitCode": 0
  },
  {
    "name": "break source inside caller loop",
    "source": "f() { :; }; for i in 1 2; do . /control; echo item:$i; done; echo end",
    "control": "break",
    "stdout": "end\n",
    "stderr": "",
    "exitCode": 0
  },
  {
    "name": "break top",
    "source": "break; echo end",
    "control": "break",
    "stdout": "end\n",
    "stderr": "shell: line 1: break: only meaningful in a `for', `while', or `until' loop\n",
    "exitCode": 0
  },
  {
    "name": "continue caller loop",
    "source": "f() { continue; echo helper; }; for i in 1 2; do f; echo item:$i; done; echo end",
    "control": "continue",
    "stdout": "helper\nitem:1\nhelper\nitem:2\nend\n",
    "stderr": "shell: line 1: continue: only meaningful in a `for', `while', or `until' loop\nshell: line 1: continue: only meaningful in a `for', `while', or `until' loop\n",
    "exitCode": 0
  },
  {
    "name": "continue nested function",
    "source": "f() { g() { continue; echo helper; }; g; }; for i in 1 2; do f; echo item:$i; done; echo end",
    "control": "continue",
    "stdout": "helper\nitem:1\nhelper\nitem:2\nend\n",
    "stderr": "shell: line 1: continue: only meaningful in a `for', `while', or `until' loop\nshell: line 1: continue: only meaningful in a `for', `while', or `until' loop\n",
    "exitCode": 0
  },
  {
    "name": "continue local loop",
    "source": "f() { for j in a b; do echo inner:$j; continue; echo unreachable; done; echo helper; }; for i in 1 2; do f; echo item:$i; done; echo end",
    "control": "continue",
    "stdout": "inner:a\ninner:b\nhelper\nitem:1\ninner:a\ninner:b\nhelper\nitem:2\nend\n",
    "stderr": "",
    "exitCode": 0
  },
  {
    "name": "continue local loop count",
    "source": "f() { for j in a b; do echo inner:$j; continue 2; echo unreachable; done; echo helper; }; for i in 1 2; do f; echo item:$i; done; echo end",
    "control": "continue",
    "stdout": "inner:a\ninner:b\nhelper\nitem:1\ninner:a\ninner:b\nhelper\nitem:2\nend\n",
    "stderr": "",
    "exitCode": 0
  },
  {
    "name": "continue resumed function",
    "source": "f() { v='a b'; for j in a b; do echo inner:$j; continue; done; echo $v; echo helper; }; for i in 1 2; do f; echo item:$i; done; echo end",
    "control": "continue",
    "stdout": "inner:a\ninner:b\na b\nhelper\nitem:1\ninner:a\ninner:b\na b\nhelper\nitem:2\nend\n",
    "stderr": "",
    "exitCode": 0
  },
  {
    "name": "continue return restores caller loop",
    "source": "f() { return 7; }; for i in 1 2; do f; echo status:$?; continue; echo item:$i; done; echo end",
    "control": "continue",
    "stdout": "status:7\nstatus:7\nend\n",
    "stderr": "",
    "exitCode": 0
  },
  {
    "name": "continue source inside function",
    "source": "f() { . /control; echo helper; }; for i in 1 2; do f; echo item:$i; done; echo end",
    "control": "continue",
    "stdout": "helper\nitem:1\nhelper\nitem:2\nend\n",
    "stderr": "/control: line 1: continue: only meaningful in a `for', `while', or `until' loop\n/control: line 1: continue: only meaningful in a `for', `while', or `until' loop\n",
    "exitCode": 0
  },
  {
    "name": "continue source inside caller loop",
    "source": "f() { :; }; for i in 1 2; do . /control; echo item:$i; done; echo end",
    "control": "continue",
    "stdout": "end\n",
    "stderr": "",
    "exitCode": 0
  },
  {
    "name": "continue top",
    "source": "continue; echo end",
    "control": "continue",
    "stdout": "end\n",
    "stderr": "shell: line 1: continue: only meaningful in a `for', `while', or `until' loop\n",
    "exitCode": 0
  }
];
for (const runtime of ["TypeScript", "Rust"]) for (const middleware of [false, true]) for (const entry of cases) {
  test(`${runtime} function loop boundary${middleware ? " through middleware" : ""}: ${entry.name}`, {skip: !WebAssembly.Suspending}, async () => {
    const {Shell,createMemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
    const fs=createMemoryFileSystem();
    await fs.writeFile("/control", new TextEncoder().encode(entry.control));
    const shell=runtime === "TypeScript" ? new Shell({fs,cwd:"/"}).use(agentCommands()) : new RustWasmBash({fs,cwd:"/",forceNative:true});
    if (middleware) shell.use((_context,next) => next());
    try {
      const r=await shell.exec(entry.source,{env:{LC_ALL:"C"}});
      assert.deepEqual([r.stdout,r.stderr,r.exitCode],[entry.stdout,entry.stderr,entry.exitCode]);
      if (runtime === "Rust") assert.equal(shell._companion,null);
    } finally {await shell.dispose();}
  });
}
