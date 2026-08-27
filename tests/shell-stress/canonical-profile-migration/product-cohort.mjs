import { differentialCases, syntaxCases } from "../cases.ts";
import { additionalCases } from "../current-gaps/cases.ts";
import { runtime } from "../probes.ts";

const rows = [];
async function snapshot(fs, directory = "/") {
  const entries = {};
  for (const entry of await fs.readdir(directory)) {
    const path = `${directory === "/" ? "" : directory}/${entry.name}`;
    const stat = await fs.stat(path);
    entries[path.slice(1)] = { type: entry.type, mode: stat.mode, ...(entry.type === "file" ? { hex: Buffer.from(await fs.readFile(path)).toString("hex") } : {}) };
    if (entry.type === "directory") Object.assign(entries, await snapshot(fs, path));
  }
  return entries;
}
for (const [cohort, fixtures] of [["differential", differentialCases], ["syntax", syntaxCases], ["current-gaps", additionalCases]]) {
  for (const fixture of fixtures) {
    const { shell, fs } = runtime();
    try {
      for (const [name, contents] of Object.entries(fixture.initialFiles ?? {})) {
        const path = `/${name}`;
        await fs.mkdir(path.slice(0, path.lastIndexOf("/")) || "/", { recursive: true });
        await fs.writeFile(path, new TextEncoder().encode(contents));
      }
      const before = await snapshot(fs);
      const result = await shell.exec(fixture.script, { stdin: fixture.stdin ?? "", env: fixture.env ?? {}, limits: fixture.limits ?? {}, signal: AbortSignal.timeout(3500) });
      rows.push({ cohort, name: fixture.name, source: fixture.script, inputHex: Buffer.from(fixture.stdin ?? "").toString("hex"), before, after: await snapshot(fs), status: result.exitCode, stdoutHex: Buffer.from(result.stdoutBytes).toString("hex"), stderrHex: Buffer.from(result.stderrBytes).toString("hex") });
    } finally { await shell.dispose(); }
  }
}
console.log(JSON.stringify({ profile: "safeplugin: unchanged runtime() using complete public src/index.ts and createStandardCommands", rows }));
