import assert from "node:assert/strict";
import { dirname } from "node:path";
import { readFileSync } from "node:fs";
import { createSearchCommands, searchCommands } from "../../../src/commands/search/index.js";
import { standardCommands } from "../../../src/commands/index.js";
import { toByteSource, type CommandContext } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";
import { bytes, type Probe, type Outcome } from "./harness.js";

const probes = JSON.parse(readFileSync(0, "utf8")) as Probe[];
const outcomes: Outcome[] = [];
for (const probe of probes) {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work/.git", { recursive: true });
  for (const [name, value] of Object.entries(probe.files ?? {})) {
    await fs.mkdir(dirname(`/work/${name}`), { recursive: true });
    await fs.writeFile(`/work/${name}`, bytes(value));
  }
  for (const [name, target] of Object.entries(probe.links ?? {})) {
    await fs.mkdir(dirname(`/work/${name}`), { recursive: true });
    await fs.symlink(target, `/work/${name}`);
  }
  const output: Buffer[] = [];
  const errors: Buffer[] = [];
  const input = bytes(probe.stdin);
  const source = async function* () {
    for (let offset = 0; offset < input.length; offset += probe.chunkSize ?? input.length) yield input.subarray(offset, offset + (probe.chunkSize ?? input.length));
  };
  const context: CommandContext = {
    command: "rg", args: probe.args, cwd: "/work", env: { LC_ALL: "C", LANG: "C" }, fs,
    stdin: probe.chunkSize ? source() : toByteSource(input), stdinIsDefault: probe.stdin === undefined, signal: new AbortController().signal,
    stdout: { async write(chunk) { output.push(Buffer.from(chunk)); } },
    stderr: { async write(chunk) { errors.push(Buffer.from(chunk)); } },
  };
  let code: number;
  if (probe.script !== undefined) {
    const shell = new Shell({ fs, cwd: "/work" }).use(standardCommands()).use(searchCommands(probe.options));
    const result = await shell.exec(probe.script, probe.stdin === undefined ? {} : { stdin: bytes(probe.stdin) });
    code = result.exitCode;
    output.push(Buffer.from(result.stdout)); errors.push(Buffer.from(result.stderr));
  } else code = (await createSearchCommands(probe.options)[0]!.execute(context)).exitCode;
  for (const [name, value] of Object.entries(probe.files ?? {})) assert.deepEqual(Buffer.from(await fs.readFile(`/work/${name}`)), bytes(value), `mutation: ${name}`);
  outcomes.push({ code, stdout: Buffer.concat(output).toString("base64"), stderr: Buffer.concat(errors).toString("base64") });
}
process.stdout.write(JSON.stringify(outcomes));
