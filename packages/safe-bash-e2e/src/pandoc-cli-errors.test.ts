import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import test from "node:test";
import {MemoryFileSystem, Shell} from "@poe-platform/safe-bash";
import {pandocCommands} from "safe-bash-command-pandoc/command";
import {RustWasmBash} from "@poe-code/safe-bash-rust";

// Pinned oracle: Pandoc 3.11. No host files are needed for these diagnostics.
test("Pandoc CLI option errors match native 3.11 and preserve existing output", async () => {
  const columns = "Argument of --columns must be a number greater than 0\n";
  const wrap = "--wrap must be auto, none, or preserve\n";
  const cases: [string[], string][] = [];
  for (const [option, values, message] of [
    ["--columns", ["0", "-1", "bad", "", "1.5", "1e2", "+2"], columns],
    ["--wrap", ["bad", "", "AUTO", "--columns"], wrap]
  ] as const) {
    for (const value of values) cases.push([[option, value], message], [[`${option}=${value}`], message]);
    const missing = `option \`${option}' requires an argument ${option === "--columns" ? "NUMBER" : "auto|none|preserve"}\nTry pandoc --help for more information.\n`;
    cases.push([[option], missing], [["--columns=0", option], missing], [["--wrap=bad", option], missing]);
  }
  cases.push([["--columns=0", "--wrap=bad"], columns], [["--wrap=bad", "--columns=0"], wrap], [["--columns", "--wrap"], columns], [["--columns=8", "--columns=0"], columns]);
  if (process.env.PANDOC_BIN) assert.match(spawnSync(process.env.PANDOC_BIN, ["--version"], {encoding: "utf8"}).stdout, /^pandoc 3\.11\n/);
  const fs = new MemoryFileSystem();
  const ts = new Shell({fs, cwd: "/"}).use(pandocCommands());
  const rust = new RustWasmBash({forceNative: false, cwd: "/", companionFactory: () => {
    const fs = new MemoryFileSystem();
    return {fs, shell: new Shell({fs, cwd: "/"}).use(pandocCommands())};
  }});
  const nativeRust = new RustWasmBash({forceNative: true, cwd: "/"});
  try {
    for (const [options, stderr] of cases) {
      const args = ["-f", "gfm", "-t", "plain", ...options];
      if (process.env.PANDOC_BIN) {
        const native = spawnSync(process.env.PANDOC_BIN, args, {input: "hello", encoding: "utf8"});
        assert.deepEqual({exitCode: native.status, stdout: native.stdout, stderr: native.stderr}, {exitCode: 6, stdout: "", stderr}, JSON.stringify(args));
      }
      for (const [name, shell, files] of [["TypeScript", ts, fs], ["Rust bridge", rust, rust.fs], ["forceNative Rust", nativeRust, nativeRust.fs]] as const) {
        for (const output of [[], ["-o", "/result"]]) {
          await files.writeFile("/result", new TextEncoder().encode("existing output"));
          const command = ["pandoc", ...output, ...args].map(arg => `'${arg.replaceAll("'", "'\\''")}'`).join(" ");
          const result = await shell.exec(command, {stdin: "hello"});
          if (shell === nativeRust) {
            // Native document conversion is intentionally unavailable; do not restore
            // the incomplete converter just to expose its argument diagnostics.
            assert.notEqual(result.exitCode, 0);
            assert.equal(result.stdout, "");
            assert.match(result.stderr, /requires the TypeScript safe-bash bridge/);
          } else {
            assert.deepEqual({exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr}, {exitCode: 6, stdout: "", stderr}, `${name}: ${command}`);
          }
          assert.equal(new TextDecoder().decode(await files.readFile("/result")), "existing output");
        }
      }
    }
  } finally {rust.dispose(); nativeRust.dispose();}
});
