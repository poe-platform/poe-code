import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createStandardCommands } from "../../src/commands/index.js";
import { setup } from "./helpers.js";

interface Record {
  name: string;
  source: string;
  stdoutBase64: string;
  stderrBase64: string;
  exitCode: number;
  files: { [name: string]: string };
}
const evidenceBytes = readFileSync(new URL("./diagnostic-reference.json", import.meta.url));
assert.equal(createHash("sha256").update(evidenceBytes).digest("hex"), "568d8bb1e653497844ba12a36001ca5c13c2c572ddedc6caf8b59bd043df6fb8");
const evidence = JSON.parse(evidenceBytes.toString()) as {
  fixtureHash: string;
  captures: { name: string; records: Record[] }[];
};
assert.equal(createHash("sha256").update(readFileSync(new URL("./diagnostic-cases.ts", import.meta.url))).digest("hex"), evidence.fixtureHash);
const primary = evidence.captures.find(profile => profile.name === "primary-5.3")!;
for (const { name, source, ...expected } of primary.records) {
  test(`pinned modern diagnostic boundary: ${name}`, async () => {
    const { shell, fs, commands } = setup({ env: { LC_ALL: "C", LANG: "C" } });
    for (const command of createStandardCommands()) commands.register(command);
    try {
      const result = await shell.exec(source);
      const files = Object.fromEntries(await Promise.all((await fs.readdir("/")).map(async entry => [entry.name, Buffer.from(await fs.readFile(`/${entry.name}`)).toString("base64")])));
      assert.deepEqual({ stdoutBase64: Buffer.from(result.stdoutBytes).toString("base64"), stderrBase64: Buffer.from(result.stderrBytes).toString("base64"), exitCode: result.exitCode, files }, expected);
    } finally { await shell.dispose(); }
  });
}
