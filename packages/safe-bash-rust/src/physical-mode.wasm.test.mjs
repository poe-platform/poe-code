import assert from "node:assert/strict";
import test from "node:test";
import {RustWasmBash} from "./index.js";

// Bash 5.3, with a link to real/child and both child-shell names pinned.
const cases = [
  {
    "name": "logical-default",
    "source": "cd link; cd ..; printf \"%s\" \"${PWD##*/}\"",
    "stdout": "work",
    "stderr": "",
    "exitCode": 0
  },
  {
    "name": "named-mode",
    "source": "cd link; set -o physical; cd ..; printf \"%s\" \"${PWD##*/}\"",
    "stdout": "real",
    "stderr": "",
    "exitCode": 0
  },
  {
    "name": "short-mode",
    "source": "cd link; set -P; cd ..; printf \"%s\" \"${PWD##*/}\"",
    "stdout": "real",
    "stderr": "",
    "exitCode": 0
  },
  {
    "name": "disable-named",
    "source": "set -P; set +o physical; cd link; cd ..; printf \"%s\" \"${PWD##*/}\"",
    "stdout": "work",
    "stderr": "",
    "exitCode": 0
  },
  {
    "name": "disable-short",
    "source": "set -o physical; set +P; cd link; cd ..; printf \"%s\" \"${PWD##*/}\"",
    "stdout": "work",
    "stderr": "",
    "exitCode": 0
  },
  {
    "name": "pwd-default",
    "source": "cd link; set -P; value=$(pwd); printf \"%s\" \"${value##*/}\"",
    "stdout": "child",
    "stderr": "",
    "exitCode": 0
  },
  {
    "name": "pwd-logical-override",
    "source": "cd link; set -P; value=$(pwd -L); printf \"%s\" \"${value##*/}\"",
    "stdout": "link",
    "stderr": "",
    "exitCode": 0
  },
  {
    "name": "cd-logical-override",
    "source": "set -P; cd -L link; cd -L ..; printf \"%s\" \"${PWD##*/}\"",
    "stdout": "work",
    "stderr": "",
    "exitCode": 0
  },
  {
    "name": "cd-physical-override",
    "source": "cd link; cd -P ..; printf \"%s\" \"${PWD##*/}\"",
    "stdout": "real",
    "stderr": "",
    "exitCode": 0
  },
  {
    "name": "subshell-inherits",
    "source": "cd link; set -P; (cd ..; printf \"%s\" \"${PWD##*/}\")",
    "stdout": "real",
    "stderr": "",
    "exitCode": 0
  },
  {
    "name": "child-resets",
    "source": "cd link; set -P; bash --noprofile --norc -c 'cd ..; printf \"%s\" \"${PWD##*/}\"'",
    "stdout": "work",
    "stderr": "",
    "exitCode": 0
  },
  {
    "name": "child-short",
    "source": "cd link; bash --noprofile --norc -P -c 'cd ..; printf \"%s\" \"${PWD##*/}\"'",
    "stdout": "real",
    "stderr": "",
    "exitCode": 0
  },
  {
    "name": "child-named",
    "source": "cd link; bash --noprofile --norc -o physical -c 'cd ..; printf \"%s\" \"${PWD##*/}\"'",
    "stdout": "real",
    "stderr": "",
    "exitCode": 0
  },
  {
    "name": "child-script",
    "source": "cd link; bash --noprofile --norc -P \"$OLDPWD/script.sh\"",
    "stdout": "real",
    "stderr": "",
    "exitCode": 0
  },
  {
    "name": "option-flags",
    "source": "set -P; case $- in *P*) printf on;; esac; set +P; case $- in *P*) printf wrong;; *) printf off;; esac",
    "stdout": "onoff",
    "stderr": "",
    "exitCode": 0
  },
  {
    "name": "option-query",
    "source": "set -P; [[ -o physical ]]; printf \"%s\" \"$?\"; set +P; [[ -o physical ]]; printf \"%s\" \"$?\"",
    "stdout": "01",
    "stderr": "",
    "exitCode": 0
  },
  {
    "name": "shopt-query",
    "source": "shopt -s -o physical; shopt -q -o physical; printf \"%s\" \"$?\"; shopt -u -o physical; shopt -q -o physical; printf \"%s\" \"$?\"",
    "stdout": "01",
    "stderr": "",
    "exitCode": 0
  },
  {
    "name": "pwd-direct",
    "source": "cd link; set -P; pwd",
    "stdout": "/work/real/child\n",
    "stderr": "",
    "exitCode": 0
  },
  {
    "name": "pwd-function",
    "source": "cd link; set -P; f() { pwd; }; f",
    "stdout": "/work/real/child\n",
    "stderr": "",
    "exitCode": 0
  },
  {
    "name": "pwd-pipeline",
    "source": "cd link; set -P; pwd | cat",
    "stdout": "/work/real/child\n",
    "stderr": "",
    "exitCode": 0
  },
  {
    "name": "pwd-loop",
    "source": "cd link; set -P; for i in 1 2; do pwd; done",
    "stdout": "/work/real/child\n/work/real/child\n",
    "stderr": "",
    "exitCode": 0
  },
  {
    "name": "pwd-logical-loop",
    "source": "cd link; set -P; for i in 1 2; do pwd -L; done",
    "stdout": "/work/link\n/work/link\n",
    "stderr": "",
    "exitCode": 0
  }
];
for (const runtime of ["TypeScript", "Rust"]) for (const entry of cases) {
  test(`${runtime} physical directory mode: ${entry.name}`, {skip: !WebAssembly.Suspending}, async () => {
    const {Shell,createMemoryFileSystem,agentCommands}=await import("@poe-platform/safe-bash");
    const fs=createMemoryFileSystem();
    await fs.mkdir("/work/real/child",{recursive:true});
    await fs.symlink("/work/real/child","/work/link");
    await fs.writeFile("/work/script.sh",new TextEncoder().encode('cd ..; printf "%s" "${PWD##*/}"'));
    const shell=runtime === "TypeScript" ? new Shell({fs,cwd:"/work"}).use(agentCommands()) : new RustWasmBash({fs,cwd:"/work",forceNative:true});
    try {
      const r=await shell.exec(entry.source,{env:{LC_ALL:"C"}});
      assert.deepEqual([r.stdout,r.stderr,r.exitCode],[entry.stdout,entry.stderr,entry.exitCode]);
      if (runtime === "Rust") assert.equal(shell._companion,null);
    } finally {await shell.dispose();}
  });
}
