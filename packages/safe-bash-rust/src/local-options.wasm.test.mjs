import assert from "node:assert/strict";
import test from "node:test";
import {RustWasmBash} from "./index.js";

// Bash 5.3, with a link to real/child and both child-shell names pinned.
const cases = [
  {
    "name": "restore-disabled",
    "source": "f() { local -; set -f; }; f; case $- in *f*) echo leaked;; *) echo restored;; esac",
    "stdout": "restored\n",
    "stderr": "",
    "exitCode": 0
  },
  {
    "name": "restore-enabled",
    "source": "set -f; f() { local -; set +f; }; f; case $- in *f*) echo restored;; *) echo leaked;; esac",
    "stdout": "restored\n",
    "stderr": "",
    "exitCode": 0
  },
  {
    "name": "first-snapshot",
    "source": "f() { local -; set -f; local -; set +B; }; f; [[ -o noglob ]]; printf \"%s\" \"$?\"; [[ -o braceexpand ]]; printf \"%s\" \"$?\"",
    "stdout": "10",
    "stderr": "",
    "exitCode": 0
  },
  {
    "name": "nested",
    "source": "g() { local -; set +f; }; f() { local -; set -f; g; case $- in *f*) printf inner;; esac; }; f; case $- in *f*) printf leaked;; *) printf outer;; esac",
    "stdout": "innerouter",
    "stderr": "",
    "exitCode": 0
  },
  {
    "name": "return",
    "source": "f() { local -; set -f; return 7; }; f; printf \"%s:\" \"$?\"; case $- in *f*) echo leaked;; *) echo restored;; esac",
    "stdout": "7:restored\n",
    "stderr": "",
    "exitCode": 0
  },
  {
    "name": "mixed-variable",
    "source": "f() { local - value=x; set -f; printf \"%s:\" \"$value\"; }; f; printf \"%s:\" \"${value-unset}\"; case $- in *f*) echo leaked;; *) echo restored;; esac",
    "stdout": "x:unset:restored\n",
    "stderr": "",
    "exitCode": 0
  },
  {
    "name": "other-changes-persist",
    "source": "f() { local -; shopt -s nullglob; value=kept; set -f; }; f; shopt -q nullglob; printf \"%s:%s\" \"$?\" \"$value\"",
    "stdout": "0:kept",
    "stderr": "",
    "exitCode": 0
  },
  {
    "name": "no-local-persists",
    "source": "f() { set -f; }; f; case $- in *f*) echo kept;; esac",
    "stdout": "kept\n",
    "stderr": "",
    "exitCode": 0
  },
  {
    "name": "boolean-fields",
    "source": "f() { local -; set -uC -o pipefail; }; f; [[ -o nounset ]]; printf \"%s\" \"$?\"; [[ -o noclobber ]]; printf \"%s\" \"$?\"; [[ -o pipefail ]]; printf \"%s\" \"$?\"",
    "stdout": "111",
    "stderr": "",
    "exitCode": 0
  },
  {
    "name": "physical",
    "source": "f() { local -; set -P; }; f; cd link; cd ..; printf \"%s\" \"${PWD##*/}\"",
    "stdout": "work",
    "stderr": "",
    "exitCode": 0
  },
  {
    "name": "physical-enabled",
    "source": "set -P; f() { local -; set +P; }; f; cd link; cd ..; printf \"%s\" \"${PWD##*/}\"",
    "stdout": "real",
    "stderr": "",
    "exitCode": 0
  },
  {
    "name": "subshell",
    "source": "f() { local -; set -f; (local -; set +f); case $- in *f*) printf inner;; esac; }; f; case $- in *f*) printf leaked;; *) printf outer;; esac",
    "stdout": "innerouter",
    "stderr": "",
    "exitCode": 0
  },
  {
    "name": "subshell-locals",
    "source": "value=global; f() { local value=outer; (local value=inner; printf \"%s:\" \"$value\"); printf \"%s:\" \"$value\"; }; f; printf \"%s\" \"$value\"",
    "stdout": "inner:outer:global",
    "stderr": "",
    "exitCode": 0
  },
  {
    "name": "substitution",
    "source": "f() { local -; set -f; value=$(local -; set +f; printf inner); printf \"%s:\" \"$value\"; case $- in *f*) printf kept;; esac; }; f; case $- in *f*) printf leaked;; *) printf restored;; esac",
    "stdout": "inner:keptrestored",
    "stderr": "",
    "exitCode": 0
  }
];
for (const runtime of ["TypeScript", "Rust"]) for (const entry of cases) {
  test(`${runtime} local set options: ${entry.name}`, {skip: !WebAssembly.Suspending}, async () => {
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
