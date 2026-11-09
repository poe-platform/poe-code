import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { setup } from "./helpers.js";
import { basicCommands } from "../../src/commands/basic.js";
import { arraysExtension } from "../../src/shell/extensions/arrays/index.js";

for (const mode of ["plain", "arrays", "middleware"]) {
  for (const command of ["break", "continue"]) {
    const inner = command === "break" ? "inner:a\n" : "inner:a\ninner:b\n";
    for (const [name, body, call, expected, diagnostics] of [
      ["caller loop", `${command}; echo helper`, "f", "helper\nitem:1\nhelper\nitem:2\nend\n", 2],
      ["nested function", `g() { ${command}; echo helper; }; g`, "f", "helper\nitem:1\nhelper\nitem:2\nend\n", 2],
      ["local loop", `for j in a b; do echo inner:$j; ${command}; echo unreachable; done; echo helper`, "f", `${inner}helper\nitem:1\n${inner}helper\nitem:2\nend\n`, 0],
      ["local loop count", `for j in a b; do echo inner:$j; ${command} 2; echo unreachable; done; echo helper`, "f", `${inner}helper\nitem:1\n${inner}helper\nitem:2\nend\n`, 0],
      ["resumed function", `v='a b'; for j in a b; do echo inner:$j; ${command}; done; echo $v; echo helper`, "f", `${inner}a b\nhelper\nitem:1\n${inner}a b\nhelper\nitem:2\nend\n`, 0],
      ["return restores caller loop", "return 7", `f; echo status:$?; ${command}`, "status:7\n".repeat(command === "break" ? 1 : 2) + "end\n", 0],
      ["source inside function", ". /control; echo helper", "f", "helper\nitem:1\nhelper\nitem:2\nend\n", 2],
      ["source inside caller loop", ":", ". /control", "end\n", 0],
    ] as const) {
      test(`${command} respects function boundaries: ${name}, ${mode}`, async context => {
        const { shell, fs } = setup({ extensions: mode === "arrays" ? [arraysExtension()] : [] });
        context.after(() => shell.dispose());
        for (const builtin of basicCommands()) shell.commands.register(builtin);
        if (mode === "middleware") shell.use((_context, next) => next());
        await fs.writeFile("/control", new TextEncoder().encode(command));
        const source = `f() { ${body}; }; for i in 1 2; do ${call}; echo item:$i; done; echo end`;
        if (mode === "plain") {
          const native = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", source.replaceAll(". /control", `. <(printf '%s' '${command}')`)], { encoding: "utf8", timeout: 2000 });
          assert.equal(native.error, undefined);
          assert.equal(native.status, 0, native.stderr);
          assert.equal(native.stdout, expected);
          assert.equal(native.stderr.split("only meaningful").length - 1, diagnostics);
        }
        const result = await shell.exec(source);
        assert.equal(result.stdout, expected);
        assert.equal(result.stderr, `${command}: only meaningful in a loop\n`.repeat(diagnostics));
        assert.equal(result.exitCode, 0);
      });
    }
  }
}
