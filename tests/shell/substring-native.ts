import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { CommandRegistry } from "../../src/contracts/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";
import { bounded, hash, profiles, quote, sourceHashes } from "./invocation-closure-native.js";
import { substringCases } from "./substring-cases.js";
import type { SubstringCase } from "./substring-cases.js";

export const substringLocales = ["C", "en_US.UTF-8"] as const;
export interface SubstringObservation { stdout: string; stderr: string; status: number; files: Record<string, string> }
export interface SubstringReference { profiles: { name: string; executable: string; sha256: string; version: string; locales: { locale: string; control: string; rows: { name: string; expected: SubstringObservation }[] }[] }[] }
export async function virtualSubstring(fixture: SubstringCase, locale: string): Promise<SubstringObservation> {
  assert.match(import.meta.resolve("../../src/shell/runtime.js"), /runtime\.ts$/u);
  const fs = new MemoryFileSystem();
  for (const [name, text] of Object.entries(fixture.files ?? {})) await fs.writeFile(`/${name}`, Buffer.from(text));
  const shell = new Shell({ fs, commands: new CommandRegistry(createStandardCommands()), env: { PATH: "", LC_ALL: locale, LANG: locale, TZ: "UTC" } });
  const result = await shell.exec(`bash -c ${quote(fixture.source)} shell`);
  const files: Record<string, string> = {};
  for (const entry of (await fs.readdir("/")).sort((left, right) => left.name.localeCompare(right.name))) if (entry.type === "file") files[entry.name] = Buffer.from(await fs.readFile(`/${entry.name}`)).toString("base64");
  return { stdout: Buffer.from(result.stdoutBytes).toString("base64"), stderr: Buffer.from(result.stderrBytes).toString("base64"), status: result.exitCode, files };
}
if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  const before = await sourceHashes();
  if (process.argv[2] === "capture") {
    const reference = { source: before, caseHash: hash(await readFile(new URL("./substring-cases.ts", import.meta.url))), argv0: "bash", commandName: "shell", profiles: [] as SubstringReference["profiles"] };
    for (const profile of profiles) {
      const version = await bounded(profile.executable, ["--version"], process.cwd(), "bash", "C");
      const locales: SubstringReference["profiles"][number]["locales"] = [];
      for (const locale of substringLocales) {
        const control = await bounded(profile.executable, ["--noprofile", "--norc", "-c", 'VALUE="é🙂"; printf "%s:%s:%s" "$BASH_VERSION" "$LC_ALL" "${#VALUE}"', "shell"], process.cwd(), "bash", locale);
        assert.equal(control.status, 0); assert.equal(control.stderr.length, 0);
        assert.ok(control.stdout.toString().endsWith(`:${locale}:${locale === "C" ? 6 : 2}`));
        const rows: SubstringReference["profiles"][number]["locales"][number]["rows"] = [];
        for (const fixture of substringCases) {
          const cwd = await mkdtemp("/tmp/safe-bash-substring-");
          try {
            for (const [name, text] of Object.entries(fixture.files ?? {})) await writeFile(`${cwd}/${name}`, text);
            const result = await bounded(profile.executable, ["--noprofile", "--norc", "-c", fixture.source, "shell"], cwd, "bash", locale);
            const files: Record<string, string> = {};
            for (const entry of (await readdir(cwd, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) if (entry.isFile()) files[entry.name] = (await readFile(`${cwd}/${entry.name}`)).toString("base64");
            rows.push({ name: fixture.name, expected: { stdout: result.stdout.toString("base64"), stderr: result.stderr.toString("base64"), status: result.status, files } });
          } finally { await rm(cwd, { recursive: true, force: true }); }
        }
        locales.push({ locale, control: control.stdout.toString(), rows });
      }
      reference.profiles.push({ ...profile, version: version.stdout.toString(), sha256: hash(await readFile(profile.executable)), locales });
    }
    console.log(JSON.stringify(reference, null, 2));
  } else {
    const reference = JSON.parse(await readFile(new URL("./substring-native.json", import.meta.url), "utf8")) as SubstringReference;
    const actual: { locale: string; name: string; observation: SubstringObservation }[] = [];
    for (const locale of substringLocales) for (const fixture of substringCases) actual.push({ locale, name: fixture.name, observation: await virtualSubstring(fixture, locale) });
    const comparisons = reference.profiles.flatMap(profile => profile.locales.map(locale => ({ profile: profile.name, locale: locale.locale, total: locale.rows.length, mismatches: locale.rows.filter(row => JSON.stringify(row.expected) !== JSON.stringify(actual.find(entry => entry.name === row.name && entry.locale === locale.locale)!.observation)).map(row => row.name) })));
    console.log(JSON.stringify({ source: before, actual, comparisons }, null, 2));
  }
  assert.deepEqual(await sourceHashes(), before);
}
