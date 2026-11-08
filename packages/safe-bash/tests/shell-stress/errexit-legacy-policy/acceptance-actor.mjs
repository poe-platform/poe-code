import { readFileSync } from "node:fs";
import { setup } from "../../shell/helpers.ts";

const reference = JSON.parse(readFileSync(new URL("./evidence.json", import.meta.url)));
const rows = [];
async function files(fs) {
  return Object.fromEntries(await Promise.all((await fs.readdir("/")).map(async entry => [entry.name, { hex: Buffer.from(await fs.readFile(`/${entry.name}`, { maxBytes: 1024 })).toString("hex"), mode: (await fs.stat(`/${entry.name}`)).mode }])));
}
function tuple(result) {
  return { status: result.exitCode, stdoutHex: Buffer.from(result.stdoutBytes).toString("hex"), stderrHex: Buffer.from(result.stderrBytes).toString("hex") };
}
const invocation = setup();
let reads = 0;
const stdin = { async *[Symbol.asyncIterator]() { reads++; yield Buffer.from("say bad"); } };
try {
  for (const name of reference.groups.invocation.modes) for (const flag of reference.groups.invocation.flags) {
    const source = `${name} '${flag}'`;
    const readsBefore = reads;
    const result = await invocation.shell.exec(source, { stdin, signal: AbortSignal.timeout(1000) });
    rows.push({ group: "invocation", name, flag, source, stdinHex: "73617920626164", readsBefore, readsAfter: reads, ...tuple(result), files: await files(invocation.fs) });
  }
} finally { await invocation.shell.dispose(); }
for (const source of reference.groups.set.sources) {
  const fixture = setup();
  try { rows.push({ group: "set", source, ...tuple(await fixture.shell.exec(source, { signal: AbortSignal.timeout(1000) })), files: await files(fixture.fs) }); }
  finally { await fixture.shell.dispose(); }
}
const direct = setup();
try {
  const body = reference.native.cases.find(row => row.id === "literal-bin-bash-e-shebang").file;
  await direct.fs.writeFile("/options", Buffer.from(body.body), { mode: body.mode });
  const before = await files(direct.fs);
  const result = await direct.shell.exec("./options", { signal: AbortSignal.timeout(1000) });
  rows.push({ group: "shebang", source: "./options", before, ...tuple(result), files: await files(direct.fs) });
} finally { await direct.shell.dispose(); }
console.log(JSON.stringify({ role: "Additive complete-row observation; not the unchanged original tests' short-circuited execution", rows }));
