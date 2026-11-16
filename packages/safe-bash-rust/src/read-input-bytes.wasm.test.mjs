import assert from "node:assert/strict";
import test from "node:test";
import {RustWasmBash} from "./index.js";

// Byte-for-byte Bash 5.2.37 results, including status, value and unread input.
const cases = [
  ["escaped NUL", "5c00410a7461696c", "-n1", "30000100410a7461696c", "30000100410a7461696c"],
  ["prefixed escaped NUL", "615c00420a7461696c", "", "300061007461696c", "300061007461696c"],
  ["invalid newline", "c30a7461696c", "-rn1", "3000c3000a7461696c", "3000c30a007461696c"],
  ["invalid ASCII", "c3417461696c", "-rn1", "3000c300417461696c", "3000c341007461696c"],
  ["invalid NUL", "c3007461696c", "-rn1", "3000c300007461696c", "3000c3007461696c"],
  ["invalid third byte", "e2820a7461696c", "-rn1", "3000e200820a7461696c", "3000e2820a007461696c"],
  ["truncated EOF", "e282", "-rn1", "3000e20082", "3000e28200"],
  ["valid UTF8", "c3a9f09f98800a7461696c", "-rn1", "3000c300a9f09f98800a7461696c", "3000c3a900f09f98800a7461696c"],
];

for (const runtime of ["TypeScript", "Rust"]) for (const locale of ["C", "en_US.UTF-8"]) {
  for (const file of [false, true]) for (const [name, hex, flags, c, utf8] of cases) {
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
          const source = (file ? "exec 3</input; " : "") + `IFS= read ${flags} ${file ? "-u3 " : ""}value; status=$?; printf '%s\\0%s\\0' "$status" "$value"; cat${file ? " <&3" : ""}`;
          const result = await shell.exec(source, {stdin});
          assert.equal(result.exitCode, 0, result.stderr);
          assert.equal(result.stderr, "");
          assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), locale === "C" ? c : utf8, `chunk size ${size}`);
        }
        if (runtime === "Rust") assert.equal(shell._companion, null);
      } finally {await shell.dispose();}
    });
  }
}
