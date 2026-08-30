import { readFileSync } from "node:fs";
import { Shell, agentCommands, createMemoryFileSystem, writeText } from "../../../src/index.js";

export interface Tuple {
  status: number;
  stdoutHex: string;
  stderrHex: string;
}

interface NativeRow {
  profile: string;
  name: string;
  args: string[];
  observed: Tuple;
}

interface Scenario {
  name: string;
  args: string[];
  extraEnv?: Record<string, string>;
  directories?: string[];
}

const original = JSON.parse(readFileSync(new URL("./native-frozen.json", import.meta.url), "utf8")) as {
  environment: Record<string, string>;
  core: NativeRow[];
};
const supplemental = JSON.parse(readFileSync(new URL("./resume-native.json", import.meta.url), "utf8")) as { rows: NativeRow[] };
const scenarios = JSON.parse(readFileSync(new URL("./resume-cases.json", import.meta.url), "utf8")) as Scenario[];
export const originalPrimary = original.core.filter(row => row.profile === "GNU9.7-Darwin");
export const supplementalPrimary = supplemental.rows.filter(row => row.profile === "GNU5.3");
export const allScenarios: Scenario[] = [...originalPrimary.map(row => ({ name: row.name, args: row.args })), ...scenarios];
export const exactNativeCases = [...originalPrimary.filter(row => row.observed.status !== 127), ...supplementalPrimary];
export const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

export async function observeCase(name: string) {
  const scenario = allScenarios.find(candidate => candidate.name === name);
  if (!scenario) throw new Error(`Missing author scenario: ${name}`);
  const fs = createMemoryFileSystem();
  for (const directory of scenario.directories ?? []) await fs.mkdir(`/${directory}`);
  const calls: string[] = [];
  const shell = new Shell({ fs, env: { PATH: "", LC_ALL: "C", LANG: "C", TZ: "UTC", ...original.environment, ...scenario.extraEnv } }).use(agentCommands());
  shell.use(async (context, next) => { calls.push(context.command); return next(); });
  shell.register({ name: "rec", async execute(context) {
    const argv = [context.command, ...context.args];
    let text = `argc=${argv.length}\n`;
    for (const [index, value] of argv.entries()) text += `arg${index}=${Buffer.from(value).toString("hex")}\n`;
    for (const key of ["V", "EMPTY", "KEEP", "A", "B", "FLAG"]) {
      text += `env:${key}=${Object.hasOwn(context.env, key) ? Buffer.from(context.env[key]!).toString("hex") : "<unset>"}\n`;
    }
    await writeText(context.stdout, text);
    return { exitCode: 0 };
  } });
  try {
    const result = await shell.exec(["env", ...scenario.args].map(quote).join(" "));
    const observed: Tuple = { status: result.exitCode, stdoutHex: Buffer.from(result.stdoutBytes).toString("hex"), stderrHex: Buffer.from(result.stderrBytes).toString("hex") };
    return { name, observed, calls, entries: (await fs.readdir("/")).map(entry => entry.name).sort() };
  } finally { await shell.dispose(); }
}
