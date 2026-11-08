import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./helpers.js";
import { basicCommands, formatPrintf } from "../../src/commands/basic.js";
import { CommandRegistry, createCommandArguments, toByteSource } from "../../src/contracts/index.js";
import { shellValueFromBytes } from "../../src/contracts/value.js";
import { Shell } from "../../src/shell/index.js";

for (const entry of [
  { operand: "1.5junk", output: "1.500000", status: 1 },
  { operand: "1e", output: "1.000000", status: 1 },
  { operand: "1e+", output: "1.000000", status: 1 },
  { operand: "1.2.3", output: "1.200000", status: 1 },
  { operand: "1.5 ", output: "1.500000", status: 1 },
  { operand: "1.5\t", output: "1.500000", status: 1 },
  { operand: "0x1.8p1junk", output: "3.000000", status: 1 },
  { operand: "0x1.8p+", output: "1.500000", status: 1 },
  { operand: "0x1.8 ", output: "1.500000", status: 1 },
  { operand: "-0.5suffix", output: "-0.500000", status: 1 },
  { operand: "-0junk", output: "-0.000000", status: 1 },
  { operand: "\u00a01.5", output: "0.000000", status: 1 },
  { operand: "\t1.5", output: "1.500000", status: 0 },
  { operand: "0x1.8p1", output: "3.000000", status: 0 },
]) for (const carrier of ["text", "raw-operand", "raw-format"]) {
  test(`printf floating prefix ${JSON.stringify(entry.operand)} ${carrier}`, async () => {
    const chunks: Uint8Array[] = [], diagnostics: Uint8Array[] = [];
    const argumentValues = createCommandArguments([
      carrier === "raw-format" ? shellValueFromBytes(Buffer.from("%f:%s")) : "%f:%s",
      carrier === "text" ? entry.operand : shellValueFromBytes(Buffer.from(entry.operand)), "done",
    ]);
    const result = await formatPrintf({
      command: "printf", args: argumentValues.args, argumentValues, cwd: "/work", env: { LC_ALL: "C.UTF-8" },
      fs: await fixture(), signal: new AbortController().signal, stdin: toByteSource(""),
      stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
      stderr: { async write(bytes) { diagnostics.push(bytes.slice()); } },
    });
    assert.equal(result.exitCode, entry.status);
    assert.equal(Buffer.concat(chunks).toString(), entry.output + ":done");
    assert.equal(Buffer.concat(diagnostics).length > 0, entry.status !== 0);
  });
}

for (const entry of [
  { value: "1.5junk", output: "1.500000" },
  { value: "0x1.8p+", output: "1.500000" },
  { value: "-0junk", output: "-0.000000" },
  { value: "1.5 ", output: "1.500000" },
]) for (const route of ["direct", "assignment", "substitution", "loop", "redirection"]) {
  for (const middleware of [false, true]) {
    test(`floating prefix ${JSON.stringify(entry.value)} through ${route} middleware=${middleware}`, async () => {
      const shell = new Shell({ fs: await fixture(), commands: new CommandRegistry(basicCommands()) });
      const intercepted: string[] = [];
      if (middleware) shell.use(async (context, next) => { intercepted.push(context.command); return next(); });
      try {
        const invocation = 'printf %f "$VALUE"';
        const capture = 'status=$?; printf "%s:%s" "$result" "$status"';
        const script = route === "direct" ? invocation
          : route === "assignment" ? `printf -v result %f "$VALUE"; ${capture}`
          : route === "substitution" ? `result=$(${invocation}); ${capture}`
          : route === "loop" ? 'for value in "$VALUE"; do printf %f "$value"; done'
          : `${invocation} > /work/printed; status=$?; printf "%s:%s" "$(< /work/printed)" "$status"`;
        const result = await shell.exec(script, { env: { LC_ALL: "C.UTF-8", VALUE: entry.value } });
        const captured = route !== "direct" && route !== "loop";
        assert.equal(result.exitCode, captured ? 0 : 1, result.stderr);
        assert.equal(result.stdout, entry.output + (captured ? ":1" : ""));
        assert.ok(result.stderr.includes(entry.value));
        if (middleware) assert.ok(intercepted.includes("printf"));
      } finally { await shell.dispose(); }
    });
  }
}
