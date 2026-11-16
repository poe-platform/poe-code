import assert from "node:assert/strict";
import test from "node:test";
import {RustWasmBash} from "./index.js";

// GNU Bash 5.3.0 results. A second builtin reads the remainder because Bash's
// stream lookahead is private to builtins; a native external cat bypasses it.
const cases = [
  ["escaped NUL", "5c00410a7461696c", "-n1", "300041000a7461696c", "300041000a7461696c"],
  ["prefixed escaped NUL", "615c00420a7461696c", "", "30006142007461696c", "30006142007461696c"],
  ["trailing escape EOF", "5c", "", "310000", "310000"],
  ["prefixed trailing escape EOF", "61625c", "-N4", "3100616200", "3100616200"],
  ["invalid newline", "c30a7461696c", "-rn1", "3000c3000a7461696c", "3000c3000a7461696c", "3000c3007461696c"],
  ["invalid ASCII", "c3417461696c", "-rn1", "3000c300417461696c", "3000c341007461696c"],
  ["invalid NUL", "c3007461696c", "-rn1", "3000c300007461696c", "3000c3007461696c"],
  ["invalid third byte", "e2820a7461696c", "-rn1", "3000e200820a7461696c", "3000e282000a7461696c", "3000e282007461696c"],
  ["truncated EOF", "e282", "-rn1", "3000e20082", "3000e28200"],
  ["valid UTF8", "c3a9f09f98800a7461696c", "-rn1", "3000c300a9f09f98800a7461696c", "3000c3a900f09f98800a7461696c"],
];

for (const runtime of ["TypeScript", "Rust"]) for (const file of [false, true]) {
  for (const delimiter of [10, 58, 0]) for (const flags of ["", "-n2", "-n3", "-N2"]) {
    test(`${runtime} Bash 5.3 malformed prefix, delimiter=${delimiter}, ${flags}, file=${file}`, {skip: !WebAssembly.Suspending}, async () => {
      const {Shell, createMemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
      const memory = createMemoryFileSystem();
      const shell = runtime === "TypeScript" ? new Shell({fs: memory, cwd: "/", env: {LC_ALL: "C.UTF-8"}}).use(agentCommands())
        : new RustWasmBash({cwd: "/", env: {LC_ALL: "C.UTF-8"}, forceNative: true});
      try {
        const bytes = Uint8Array.from([97, 195, delimiter, 98, delimiter, 90, delimiter]);
        const delim = delimiter === 10 ? "" : delimiter === 0 ? "-d ''" : "-d ':'";
        for (const size of file ? [bytes.length] : [1, 2, 7]) {
          if (file) await (runtime === "TypeScript" ? memory : shell.fs).writeFile("/input", bytes);
          const stdin = {async *[Symbol.asyncIterator]() {
            for (let offset = 0; offset < bytes.length; offset += size) yield bytes.subarray(offset, offset + size);
          }};
          const result = await shell.exec(`{ IFS= read -r ${flags} ${delim} a; status=$?; IFS= read -r ${delim} b; printf '%s|%s|%s|%s' "$status" "$?" "$a" "$b"; }${file ? " </input" : ""}`, {stdin});
          const retained = flags === "-N2" && delimiter !== 0 ? [delimiter] : [];
          const next = flags === "-n2" && !file ? [] : [98];
          assert.equal(result.exitCode, 0, result.stderr);
          assert.equal(result.stderr, "");
          assert.deepEqual(result.stdoutBytes, Uint8Array.from([48, 124, 48, 124, 97, 195, ...retained, 124, ...next]), `chunk size ${size}`);
        }
        if (runtime === "Rust") assert.equal(shell._companion, null);
      } finally {await shell.dispose();}
    });
  }
}

for (const runtime of ["TypeScript", "Rust"]) for (const locale of ["C", "en_US.UTF-8"]) {
  for (const file of [false, true]) for (const [name, hex, flags, c, utf8, utf8File = utf8] of cases) {
    test(`${runtime} read ${name}, ${locale}, file=${file}`, {skip: !WebAssembly.Suspending}, async () => {
      const {Shell, createMemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
      const memory = createMemoryFileSystem();
      const shell = runtime === "TypeScript" ? new Shell({fs: memory, cwd: "/", env: {LC_ALL: locale}}).use(agentCommands())
        : new RustWasmBash({cwd: "/", env: {LC_ALL: locale}, forceNative: true});
      try {
        const bytes = Buffer.from(hex, "hex");
        for (const size of file ? [bytes.length] : [1, 2, 7]) {
          if (file) await (runtime === "TypeScript" ? memory : shell.fs).writeFile("/input", bytes);
          const stdin = {async *[Symbol.asyncIterator]() {
            for (let offset = 0; offset < bytes.length; offset += size) yield bytes.subarray(offset, offset + size);
          }};
          const source = (file ? "exec 3</input; " : "") + `IFS= read ${flags} ${file ? "-u3 " : ""}value; status=$?; printf '%s\\0%s\\0' "$status" "$value"; while IFS= read -r -d '' ${file ? "-u3 " : ""}rest; do printf '%s\\0' "$rest"; done; printf '%s' "$rest"`;
          const result = await shell.exec(source, {stdin});
          assert.equal(result.exitCode, 0, result.stderr);
          assert.equal(result.stderr, "");
          assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), locale === "C" ? c : file ? utf8File : utf8, `chunk size ${size}`);
        }
        if (runtime === "Rust") assert.equal(shell._companion, null);
      } finally {await shell.dispose();}
    });
  }
}
