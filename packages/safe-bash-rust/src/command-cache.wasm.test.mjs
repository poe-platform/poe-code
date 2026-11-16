import assert from "node:assert/strict";
import test from "node:test";
import {RustWasmBash} from "./index.js";

// Expected output verified with Bash 5.2; host mutations leave shell state alone.
const cases = [
  {
    "name": "dot deleted",
    "path": ".",
    "script": "tool; remove; command -v tool; echo found:$?; hash -t tool; echo hash:$?",
    "stdout": "work\nfound:1\nhash:1\n",
    "stderr": "hash: tool: not found\n",
    "status": 0
  },
  {
    "name": "dot revoked",
    "path": ".",
    "script": "tool; revoke; command -v tool; echo found:$?; hash -t tool; echo hash:$?",
    "stdout": "work\n./tool\nfound:0\nhash:1\n",
    "stderr": "hash: tool: not found\n",
    "status": 0
  },
  {
    "name": "dot deleted alt",
    "path": ".:/alt",
    "script": "tool; remove; command -v tool; echo found:$?; tool; hash -t tool",
    "stdout": "work\n/alt/tool\nfound:0\nalt\n/alt/tool\n",
    "stderr": "",
    "status": 0
  },
  {
    "name": "dot revoked alt",
    "path": ".:/alt",
    "script": "tool; revoke; command -v tool; echo found:$?; tool; hash -t tool",
    "stdout": "work\n/alt/tool\nfound:0\nalt\n/alt/tool\n",
    "stderr": "",
    "status": 0
  },
  {
    "name": "dot cwd change",
    "path": ".",
    "script": "tool; cd /alt; command -v tool; tool; hash -t tool",
    "stdout": "work\n./tool\nalt\n./tool\n",
    "stderr": "",
    "status": 0
  },
  {
    "name": "absolute deleted",
    "path": "/work:/alt",
    "script": "tool; remove; command -v tool; tool; echo exec:$?; hash -t tool",
    "stdout": "work\n/work/tool\nexec:127\n/work/tool\n",
    "stderr": "/work/tool: No such file or directory\n",
    "status": 0
  },
  {
    "name": "absolute revoked",
    "path": "/work:/alt",
    "script": "tool; revoke; command -v tool; tool; echo exec:$?; hash -t tool",
    "stdout": "work\n/work/tool\nexec:126\n/work/tool\n",
    "stderr": "/work/tool: Permission denied\n",
    "status": 0
  },
  {
    "name": "relative deleted",
    "path": "../work:/alt",
    "script": "tool; remove; command -v tool; tool; echo exec:$?; hash -t tool",
    "stdout": "work\n/alt/tool\nalt\nexec:0\n/alt/tool\n",
    "stderr": "",
    "status": 0
  },
  {
    "name": "relative present",
    "path": "../work:/alt",
    "script": "tool; command -v tool; hash -t tool",
    "stdout": "work\n./../work/tool\n./../work/tool\n",
    "stderr": "",
    "status": 0
  },
  {
    "name": "explicit missing",
    "path": "/work",
    "script": "hash -p /absent/tool tool; command -v tool; tool; echo exec:$?; hash -t tool",
    "stdout": "/absent/tool\nexec:127\n/absent/tool\n",
    "stderr": "/absent/tool: No such file or directory\n",
    "status": 0
  },
  {
    "name": "never hashed",
    "path": "/work",
    "script": "hash -t tool; echo hash:$?",
    "stdout": "hash:1\n",
    "stderr": "hash: tool: not found\n",
    "status": 0
  },
  {
    "name": "reset",
    "path": "/work",
    "script": "tool; hash -r; hash -t tool; echo hash:$?",
    "stdout": "work\nhash:1\n",
    "stderr": "hash: tool: not found\n",
    "status": 0
  },
  {
    "name": "path assignment",
    "path": "/work",
    "script": "tool; PATH=/work; hash -t tool; echo hash:$?",
    "stdout": "work\nhash:1\n",
    "stderr": "hash: tool: not found\n",
    "status": 0
  },
  {
    "name": "path unset",
    "path": "/work",
    "script": "tool; unset PATH; hash -t tool; echo hash:$?",
    "stdout": "work\nhash:1\n",
    "stderr": "hash: tool: not found\n",
    "status": 0
  },
  {
    "name": "disable",
    "path": "/work",
    "script": "tool; set +h; remove; command -v tool; echo found:$?; set -h; hash -t tool",
    "stdout": "work\nfound:1\n/work/tool\n",
    "stderr": "",
    "status": 0
  },
  {
    "name": "checkhash removal",
    "path": "/work:/alt",
    "script": "tool; remove; shopt -s checkhash; tool; hash -t tool",
    "stdout": "work\nalt\n/alt/tool\n",
    "stderr": "",
    "status": 0
  },
  {
    "name": "checkhash revoked",
    "path": "/work:/alt",
    "script": "tool; revoke; shopt -s checkhash; tool; hash -t tool",
    "stdout": "work\nalt\n/alt/tool\n",
    "stderr": "",
    "status": 0
  },
  {
    "name": "explicit dot",
    "path": ".:/alt",
    "script": "hash -p ./tool tool; remove; command -v tool; tool; hash -t tool",
    "stdout": "/alt/tool\nalt\n/alt/tool\n",
    "stderr": "",
    "status": 0
  },
  {
    "name": "new dot shadow",
    "path": ".:/alt",
    "script": "remove; tool; restore; command -v tool; tool; hash -t tool",
    "stdout": "alt\n./tool\nwork\n./tool\n",
    "stderr": "",
    "status": 0
  },
  {
    "name": "empty hash",
    "path": "",
    "script": "tool; hash -t tool; echo hash:$?",
    "stdout": "work\nhash:1\n",
    "stderr": "hash: tool: not found\n",
    "status": 0
  },
  {
    "name": "uncached denied",
    "path": ".",
    "script": "revoke; command -v tool; echo found:$?",
    "stdout": "./tool\nfound:0\n",
    "stderr": "",
    "status": 0
  },
  {
    "name": "uncached all denied",
    "path": ".",
    "script": "revoke; type -ap tool; echo found:$?",
    "stdout": "found:1\n",
    "stderr": "",
    "status": 0
  },
  {
    "name": "explicit bypass",
    "path": "/work",
    "script": "hash -p /alt/tool tool; command -pv tool; echo found:$?; hash -t tool",
    "stdout": "/alt/tool\nfound:0\n/alt/tool\n",
    "stderr": "",
    "status": 0
  },
  {
    "name": "prefix PATH",
    "path": "/work",
    "script": "tool; PATH=/alt tool; hash -t tool; tool",
    "stdout": "work\nalt\nwork\n",
    "stderr": "hash: tool: not found\n",
    "status": 0
  },
  {
    "name": "absolute cwd change",
    "path": "/work:/alt",
    "script": "tool; cd /alt; command -v tool; tool; hash -t tool",
    "stdout": "work\n/work/tool\nwork\n/work/tool\n",
    "stderr": "",
    "status": 0
  },
  {
    "name": "dot behind chosen directory",
    "path": "/alt:.",
    "script": "tool; command -v tool; tool; hash -t tool",
    "stdout": "alt\n/alt/tool\nalt\n/alt/tool\n",
    "stderr": "",
    "status": 0
  },
  {
    "name": "explicit hash ignores earlier dot",
    "path": ".:/alt",
    "script": "hash -p /alt/tool tool; command -v tool; tool; hash -t tool",
    "stdout": "/alt/tool\nalt\n/alt/tool\n",
    "stderr": "",
    "status": 0
  },
  {
    "name": "all paths bypass cached absolute",
    "path": "/work:/alt",
    "script": "tool; remove; type -ap tool; hash -t tool",
    "stdout": "work\n/alt/tool\n/work/tool\n",
    "stderr": "",
    "status": 0
  },
  {
    "name": "disable hash builtin",
    "path": "/work",
    "script": "hash -p /alt/tool tool; set +o hashall; hash -r; echo reset:$?; set -o hashall; hash -t tool",
    "stdout": "reset:1\n/alt/tool\n",
    "stderr": "hash: hashing disabled\n",
    "status": 0
  },
  {
    "name": "hashall queries",
    "path": "/work",
    "script": "shopt -qo hashall; echo enabled:$?; [ -o hashall ]; echo test:$?; case $- in *h*) echo flag:on;; esac; set +h; shopt -qo hashall; echo disabled:$?; [ -o hashall ]; echo test:$?",
    "stdout": "enabled:0\ntest:0\nflag:on\ndisabled:1\ntest:1\n",
    "stderr": "",
    "status": 0
  },
  {
    "name": "checkhash with no alternative",
    "path": "/work",
    "script": "tool; remove; shopt -s checkhash; tool; echo exec:$?; hash -t tool; echo hash:$?",
    "stdout": "work\nexec:127\nhash:1\n",
    "stderr": "tool: command not found\nhash: tool: not found\n",
    "status": 0
  },
  {
    "name": "subshell reset is isolated",
    "path": "/work",
    "script": "tool; (hash -r; hash -t tool; echo child:$?); hash -t tool",
    "stdout": "work\nchild:1\n/work/tool\n",
    "stderr": "hash: tool: not found\n",
    "status": 0
  },
  {
    "name": "delete retained dot cache",
    "path": ".",
    "script": "tool; remove; command -v tool; echo found:$?; hash -d tool; echo delete:$?; hash -d tool; echo twice:$?",
    "stdout": "work\nfound:1\ndelete:0\ntwice:1\n",
    "stderr": "hash: tool: not found\n",
    "status": 0
  },
  {
    "name": "redirected external execution",
    "path": "/work:/alt",
    "script": "tool <<<'input'; remove; command -v tool; hash -t tool",
    "stdout": "work\n/work/tool\n/work/tool\n",
    "stderr": "",
    "status": 0
  },
  {
    "name": "unrelated prefix preserves cache",
    "path": "/work:/alt",
    "script": "X=value tool; remove; command -v tool; hash -t tool",
    "stdout": "work\n/work/tool\n/work/tool\n",
    "stderr": "",
    "status": 0
  },
  {
    "name": "redirected prefix PATH clears cache",
    "path": "/work",
    "script": "tool; PATH=/alt tool <<<'input'; hash -t tool; echo hash:$?",
    "stdout": "work\nalt\nhash:1\n",
    "stderr": "hash: tool: not found\n",
    "status": 0
  },
  {
    "name": "redirected empty PATH stays uncached",
    "path": "",
    "script": "tool <<<'input'; hash -t tool; echo hash:$?",
    "stdout": "work\nhash:1\n",
    "stderr": "hash: tool: not found\n",
    "status": 0
  },
  {
    "name": "revoked symlink is discoverable but cannot execute",
    "path": "/work",
    "script": "revoke; command -v link; type -ap link; echo executable:$?; command link; echo exec:$?",
    "stdout": "/work/link\nexecutable:1\nexec:126\n",
    "stderr": "/work/link: Permission denied\n",
    "status": 0
  }
];

for (const runtime of ["TypeScript", "Rust"]) for (const fixture of cases) {
  test(`${runtime} command cache: ${fixture.name}`, {skip: !WebAssembly.Suspending}, async () => {
    const {Shell, createMemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
    const fs = createMemoryFileSystem();
    for (const directory of ["work", "alt"]) {
      await fs.mkdir(`/${directory}`);
      await fs.writeFile(`/${directory}/tool`, Buffer.from(`#!/bin/bash\nprintf '${directory}\\n'\n`), {mode: 0o755});
    }
    await fs.symlink("tool", "/work/link");
    const shell = runtime === "TypeScript" ? new Shell({fs, cwd: "/work"}).use(agentCommands())
      : new RustWasmBash({fs, cwd: "/work", forceNative: true});
    shell.use({name: "host-mutations", setup(host) {
      host.commands.register({name: "remove", async execute() {await fs.rm("/work/tool"); return {exitCode: 0};}});
      host.commands.register({name: "revoke", async execute() {await fs.chmod("/work/tool", 0o644); return {exitCode: 0};}});
      host.commands.register({name: "restore", async execute() {
        await fs.writeFile("/work/tool", Buffer.from("#!/bin/bash\nprintf 'work\\n'\n"), {mode: 0o755});
        return {exitCode: 0};
      }});
    }});
    try {
      const result = await shell.exec(`PATH='${fixture.path}'; ${fixture.script}`);
      assert.equal(result.stdout, fixture.stdout);
      assert.equal(result.exitCode, fixture.status);
      assert.equal(result.stderr.replace(/(?:shell|bash): line \d+: /g, ""), fixture.stderr);
      if (runtime === "Rust") assert.equal(shell._companion, null);
    } finally {await shell.dispose();}
  });
}

for (const runtime of ["TypeScript", "Rust"]) {
  test(`${runtime} discovery does not report a file when stat is denied`, {skip: !WebAssembly.Suspending}, async () => {
    const {Shell, createMemoryFileSystem, FsError} = await import("@poe-platform/safe-bash");
    const backing = createMemoryFileSystem();
    await backing.mkdir("/work");
    await backing.writeFile("/work/tool", Buffer.from("true\n"), {mode: 0o755});
    const fs = new Proxy(backing, {get(target, key) {
      if (key === "stat") return async path => {
        if (path === "/work/tool") throw new FsError("EACCES", {path});
        return target.stat(path);
      };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    }});
    const shell = runtime === "TypeScript" ? new Shell({fs, cwd: "/work"})
      : new RustWasmBash({fs, cwd: "/work", forceNative: true});
    try {
      const result = await shell.exec("PATH=/work; command -v tool");
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 1);
      if (runtime === "Rust") assert.equal(shell._companion, null);
    } finally {await shell.dispose();}
  });
}

