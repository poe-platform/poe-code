import assert from "node:assert/strict";
import test from "node:test";
import {RustWasmBash} from "./index.js";

// Bash 5.3.0 quotes the complete UTF-8 unit; C locale still quotes one byte.
const cases = [
  ["é", "C", false, "300061c30062c3a963c3a964007461696c"],
  ["é", "C", true, "3000615c00a962c3a963c3a964007461696c"],
  ["é", "en_US.UTF-8", false, "300061c3a9620063c3a964007461696c"],
  ["é", "en_US.UTF-8", true, "3000615c0062c3a963c3a964007461696c"],
  ["😀", "C", false, "300061f000988062f09f988063f09f988064007461696c"],
  ["😀", "C", true, "3000615c009f988062f09f988063f09f988064007461696c"],
  ["😀", "en_US.UTF-8", false, "300061f09f9880620063f09f988064007461696c"],
  ["😀", "en_US.UTF-8", true, "3000615c0062f09f988063f09f988064007461696c"],
];
for (const runtime of ["TypeScript", "Rust"]) for (const [char, locale, raw, expected] of cases) {
  test(`${runtime} read IFS=${char}, ${locale}, raw=${raw}`, {skip: !WebAssembly.Suspending}, async () => {
    const {Shell, createMemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
    const shell = runtime === "TypeScript" ? new Shell({fs: createMemoryFileSystem(), env: {LC_ALL: locale}}).use(agentCommands())
      : new RustWasmBash({cwd: "/", env: {LC_ALL: locale}, forceNative: true});
    try {
      const bytes = Buffer.from(`a\\${char}b${char}c${char}d\ntail`);
      for (const size of [1, 2, 7]) {
        const stdin = {async *[Symbol.asyncIterator]() {
          for (let offset = 0; offset < bytes.length; offset += size) yield bytes.subarray(offset, offset + size);
        }};
        const result = await shell.exec(`IFS=${char} read ${raw ? "-r " : ""}first second; status=$?; printf '%s\\0%s\\0%s\\0' "$status" "$first" "$second"; cat`, {stdin});
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stderr, "");
        assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), expected, `chunk size ${size}`);
      }
      if (runtime === "Rust") assert.equal(shell._companion, null);
    } finally {await shell.dispose();}
  });
}
