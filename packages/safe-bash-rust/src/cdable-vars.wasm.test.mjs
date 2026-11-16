import assert from "node:assert/strict";
import test from "node:test";
import {RustWasmBash} from "./index.js";

// GNU Bash 5.3, LC_ALL=C, with the fixture root normalized to /work.
const cases = [
  [
    "alias=target; cd alias; rc=$?; printf \"status=%s pwd=%s\\n\" \"$rc\" \"${PWD##*/}\"",
    "status=1 pwd=work\n",
    "shell: line 1: cd: alias: No such file or directory\n",
    0
  ],
  [
    "shopt -s cdable_vars; alias=target; cd alias; rc=$?; printf \"status=%s pwd=%s\\n\" \"$rc\" \"${PWD##*/}\"",
    "target\nstatus=0 pwd=target\n",
    "",
    0
  ],
  [
    "shopt -s cdable_vars; alias=\"\"; cd alias; rc=$?; printf \"status=%s pwd=%s\\n\" \"$rc\" \"${PWD##*/}\"",
    "\nstatus=0 pwd=work\n",
    "",
    0
  ],
  [
    "shopt -s cdable_vars; local=target; cd local; rc=$?; printf \"status=%s pwd=%s\\n\" \"$rc\" \"${PWD##*/}\"",
    "status=0 pwd=local\n",
    "",
    0
  ],
  [
    "shopt -s cdable_vars; alias=target; CDPATH=search; cd alias; rc=$?; printf \"status=%s pwd=%s\\n\" \"$rc\" \"${PWD##*/}\"",
    "/work/search/alias\nstatus=0 pwd=alias\n",
    "",
    0
  ],
  [
    "shopt -s cdable_vars; alias=relative; CDPATH=search; cd alias; rc=$?; printf \"status=%s pwd=%s\\n\" \"$rc\" \"${PWD##*/}\"",
    "/work/search/alias\nstatus=0 pwd=alias\n",
    "",
    0
  ],
  [
    "shopt -s cdable_vars; file=target; cd file; rc=$?; printf \"status=%s pwd=%s\\n\" \"$rc\" \"${PWD##*/}\"",
    "target\nstatus=0 pwd=target\n",
    "",
    0
  ],
  [
    "shopt -s cdable_vars; alias=missing; cd alias; rc=$?; printf \"status=%s pwd=%s\\n\" \"$rc\" \"${PWD##*/}\"",
    "status=1 pwd=work\n",
    "shell: line 1: cd: alias: No such file or directory\n",
    0
  ],
  [
    "shopt -s cdable_vars; cd missing; rc=$?; printf \"status=%s pwd=%s\\n\" \"$rc\" \"${PWD##*/}\"",
    "status=1 pwd=work\n",
    "shell: line 1: cd: missing: No such file or directory\n",
    0
  ],
  [
    "shopt -s cdable_vars; alias=target; cd ./alias; rc=$?; printf \"status=%s pwd=%s\\n\" \"$rc\" \"${PWD##*/}\"",
    "status=1 pwd=work\n",
    "shell: line 1: cd: ./alias: No such file or directory\n",
    0
  ],
  [
    "shopt -s cdable_vars; alias=target; (cd alias); shopt -q cdable_vars; rc=$?; printf \"status=%s pwd=%s\\n\" \"$rc\" \"${PWD##*/}\"",
    "target\nstatus=0 pwd=work\n",
    "",
    0
  ],
  [
    "shopt -s cdable_vars; alias=target; out=$(cd alias); printf \"sub=%s\\n\" \"$out\"; rc=$?; printf \"status=%s pwd=%s\\n\" \"$rc\" \"${PWD##*/}\"",
    "sub=target\nstatus=0 pwd=work\n",
    "",
    0
  ],
  [
    "shopt -s cdable_vars; alias=target; shopt -u cdable_vars; cd alias; rc=$?; printf \"status=%s pwd=%s\\n\" \"$rc\" \"${PWD##*/}\"",
    "status=1 pwd=work\n",
    "shell: line 1: cd: alias: No such file or directory\n",
    0
  ],
  [
    "shopt -p cdable_vars; shopt -s cdable_vars; shopt -p cdable_vars; rc=$?; printf \"status=%s pwd=%s\\n\" \"$rc\" \"${PWD##*/}\"",
    "shopt -u cdable_vars\nshopt -s cdable_vars\nstatus=0 pwd=work\n",
    "",
    0
  ],
  [
    "shopt -s cdable_vars; alias=target; declare -n ref=alias; cd ref; rc=$?; printf \"status=%s pwd=%s\\n\" \"$rc\" \"${PWD##*/}\"",
    "target\nstatus=0 pwd=target\n",
    "",
    0
  ],
  [
    "shopt -s cdable_vars; shortcut=relative; CDPATH=search; cd shortcut; rc=$?; printf \"status=%s pwd=%s\\n\" \"$rc\" \"${PWD##*/}\"",
    "status=1 pwd=work\n",
    "shell: line 1: cd: shortcut: No such file or directory\n",
    0
  ],
  [
    "shopt -s cdable_vars; alias=/work/target; cd alias; rc=$?; printf \"status=%s pwd=%s\\n\" \"$rc\" \"${PWD##*/}\"",
    "/work/target\nstatus=0 pwd=target\n",
    "",
    0
  ]
];
for (const runtime of ["TypeScript", "Rust"]) for (const [source, stdout, stderr, exitCode] of cases) {
  test(`${runtime} directory variable: ${source}`, {skip: !WebAssembly.Suspending}, async () => {
    const {Shell, createMemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
    const shell = runtime === "TypeScript" ? new Shell({fs: createMemoryFileSystem(), cwd: "/"}).use(agentCommands())
      : new RustWasmBash({cwd: "/", forceNative: true});
    try {
      const result = await shell.exec(`mkdir -p /work/target /work/local /work/search/alias /work/search/relative; echo x > /work/file; cd /work; ${source}`);
      assert.equal(result.stdout, stdout);
      assert.equal(result.stderr, stderr);
      assert.equal(result.exitCode, exitCode);
      if (runtime === "Rust") assert.equal(shell._companion, null);
    } finally {await shell.dispose();}
  });
}
