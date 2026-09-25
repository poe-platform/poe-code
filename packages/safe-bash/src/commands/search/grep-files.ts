import { assertCommandRequirements, type CommandContext } from "../../contracts/index.js";
import { diagnostic, lines, pathOf, UsageError, value, type ParsedOptions } from "../internal.js";
import { matchesPattern } from "../../shell/pattern.js";
import { grepRequirements, requiredFileInput } from "./requirements.js";

const bufferLimit = Infinity;

interface GrepFile { name: string; nested: boolean }

export async function* grepFiles(context: CommandContext, parsed: ParsedOptions, filters: readonly { key: string; pattern: string }[], report: () => void, directoriesOverride?: string): AsyncGenerator<GrepFile> {
  const directories = directoriesOverride ?? value(parsed, "d") ?? (parsed.flags.has("r") || parsed.flags.has("R") ? "recurse" : "read");
  const devices = value(parsed, "D") ?? "read";
  if (!["read", "skip", "recurse"].includes(directories)) throw new UsageError(`invalid argument '${directories}' for 'directories'`);
  if (!["read", "skip"].includes(devices)) throw new UsageError(`invalid argument '${devices}' for 'devices'`);
  const work = { signal: context.signal, remaining: Infinity, exhausted() { throw new UsageError("file filter work limit exceeded"); } };
  const rules: { pattern: string; include: boolean }[] = [];
  for (const { key, pattern } of filters) {
    if (key === "include" || key === "exclude") rules.push({ pattern, include: key === "include" });
    if (key === "exclude-from") {
      for await (const line of lines(requiredFileInput(context, grepRequirements, "pattern-file", pattern, bufferLimit))) rules.push({ pattern: Buffer.from(line.bytes).toString(), include: false });
    }
  }
  const excludedDirectories = parsed.values.get("exclude-dir") ?? [];
  const initialInclude = !rules.some(rule => rule.include);
  async function* visit(name: string, ancestors: Set<string>, depth: number, explicit: boolean): AsyncGenerator<GrepFile> {
    context.signal.throwIfAborted();
    if (name === "-") { yield { name, nested: false }; return; }
    const base = name.slice(name.lastIndexOf("/") + 1);
    try {
      // Keep plain searches usable on read-only adapters without metadata.
      if (directories !== "read" || parsed.flags.has("r") || parsed.flags.has("R") || devices === "skip") {
        assertCommandRequirements(context, grepRequirements, ["metadata"]);
        const path = pathOf(context, name);
        const stat = await (explicit || parsed.flags.has("R") ? context.fs.stat(path, { signal: context.signal }) : context.fs.lstat(path, { signal: context.signal }));
        if (stat.type === "symlink" && !explicit && !parsed.flags.has("R")) return;
        if (stat.type === "directory") {
          if (directories === "skip") return;
          if (directories === "read") { yield { name, nested: depth > 0 }; return; }
          for (const pattern of excludedDirectories) if (await matchesPattern(pattern, base, work)) return;
          assertCommandRequirements(context, grepRequirements, ["directory"]);
          const canonical = await context.fs.realpath(path, { signal: context.signal });
          if (ancestors.has(canonical)) throw new UsageError(`${name}: recursive directory loop`);
          const next = new Set(ancestors).add(canonical);
          for (const entry of await context.fs.readdir(path, { signal: context.signal })) {
            yield* visit(`${name.endsWith("/") ? name.slice(0, -1) : name}/${entry.name}`, next, depth + 1, false);
          }
          return;
        }
        if (stat.type !== "file" && devices === "skip") return;
      }
      let included = initialInclude;
      for (const rule of rules) if (await matchesPattern(rule.pattern, base, work)) included = rule.include;
      if (included) yield { name, nested: depth > 0 };
    } catch (error) {
      context.signal.throwIfAborted();
      report();
      if (!parsed.flags.has("s")) await diagnostic(context, error);
    }
  }
  const names = parsed.operands.length ? parsed.operands : [directories === "recurse" ? "." : "-"];
  for (const name of names) yield* visit(name, new Set(), 0, true);
}
