import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../../src/shell/shell.js";
import { ShellLimitError } from "../../../src/shell/types.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { getCommandArguments } from "../../../src/contracts/index.js";
import { shellValueBytes } from "../../../src/contracts/value.js";

for (const [mode, escaped, expected] of [["raw", "\\200\\377", "80ff"], ["ASCII control", "\\141\\142", "6162"]] as const) for (const exhausted of [false, true]) {
  test(`eval source quota charges ${mode} bytes cumulatively, exhausted=${exhausted}`, async () => {
    const fs = new MemoryFileSystem();
    const script = `raw=$'${escaped}'; eval "capture '$raw'"; eval "capture '$raw'"\n`;
    const entry = "sh /review.sh";
    const evaluatedLength = Buffer.byteLength("capture ''") + 2;
    const cap = Buffer.byteLength(entry) + Buffer.byteLength(script) + evaluatedLength * 2 - Number(exhausted);
    await fs.writeFile("/review.sh", Buffer.from(script));
    const captured: string[] = [];
    const shell = new Shell({ fs, env: { LC_ALL: "C" } });
    shell.commands.register({ name: "capture", async execute(context) {
      captured.push(Buffer.from(shellValueBytes(getCommandArguments(context).values[0]!)).toString("hex"));
      return { exitCode: 0 };
    } });
    try {
      const execution = shell.exec(entry, { limits: { maxSourceBytes: cap } });
      if (exhausted) await assert.rejects(execution, error => error instanceof ShellLimitError && error.limit === "maxSourceBytes");
      else assert.equal((await execution).exitCode, 0);
      assert.deepEqual(captured, exhausted ? [expected] : [expected, expected]);
    } finally { await shell.dispose(); }
  });
}

test("generated eval source consumes the shared parse quota before command admission", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/review.sh", Buffer.from('code=$(payload); eval "$code"\n'));
  const shell = new Shell({ fs });
  let payloads = 0;
  let captures = 0;
  shell.commands.register({ name: "payload", async execute(context) {
    payloads++;
    await context.stdout.write(Buffer.from(`capture ${"word ".repeat(500)}`));
    return { exitCode: 0 };
  } });
  shell.commands.register({ name: "capture", async execute() { captures++; return { exitCode: 0 }; } });
  try {
    await assert.rejects(shell.exec("sh /review.sh", { limits: { maxParseUnits: 512 } }), error => error instanceof ShellLimitError && error.limit === "maxParseUnits");
    assert.equal(payloads, 1);
    assert.equal(captures, 0);
  } finally { await shell.dispose(); }
});

for (const phase of ["eval", "trim"] as const) for (const reason of [false, 0, "", null]) {
  test(`saved raw ${phase} cancellation after readiness blocks subsequent effects ${JSON.stringify(reason)}`, async () => {
    const fs = new MemoryFileSystem();
    const script = phase === "eval" ? 'code=$(payload); eval "$code"\n' : 'value=$(payload); ready; capture "${value%?}"\n';
    await fs.writeFile("/review.sh", Buffer.from(script));
    const caller = new AbortController();
    const shell = new Shell({ fs, env: { LC_ALL: "C" } });
    let captures = 0;
    let ready = false;
    shell.commands.register({ name: "payload", async execute(context) {
      const bytes = phase === "eval"
        ? Buffer.concat([Buffer.from("capture '"), Buffer.alloc(32_768, 255), Buffer.from("'")])
        : Buffer.alloc(32_768, 255);
      await context.stdout.write(bytes);
      return { exitCode: 0 };
    } });
    shell.commands.register({ name: "ready", async execute() {
      ready = true;
      caller.abort(reason);
      return { exitCode: 0 };
    } });
    shell.commands.register({ name: "capture", async execute() { captures++; return { exitCode: 0 }; } });
    if (phase === "eval") shell.use(async (context, next) => {
      if (context.command === "eval") {
        ready = true;
        caller.abort(reason);
      }
      return next();
    });
    try {
      await assert.rejects(shell.exec("sh /review.sh", { signal: caller.signal }), error => Object.is(error, reason));
      assert.equal(ready, true);
      assert.equal(captures, 0);
    } finally { await shell.dispose(); }
  });
}
