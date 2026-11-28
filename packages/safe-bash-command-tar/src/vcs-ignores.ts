import { resolvePath, type CommandContext } from "safe-bash-contracts";
import { checkPath, fail, maybeStat, smallFile, text, type ArchiveLimits } from "safe-bash-io-engine/commands/archive/internal";
import { Budget } from "safe-bash-io-engine/commands/text-programs/shared";
import { Pattern } from "safe-bash-regex-engine/text/regex";
import { Exclusions } from "./options.js";

interface Rule { pattern: Exclusions | Pattern; include: boolean }
export interface IgnoreFile { recursive: boolean; rules: Rule[] }

export class VcsIgnores {
  private bytes = 0;
  private patterns = 0;
  private readonly work: { remaining: number };
  private readonly regexBudget: Budget;
  constructor(private readonly context: CommandContext, private readonly limits: ArchiveLimits) {
    this.work = { remaining: limits.maxPatternSteps };
    this.regexBudget = new Budget(context, {
      ...(Number.isFinite(limits.maxPatternSteps) ? { maxSteps: limits.maxPatternSteps } : {}),
      ...(Number.isFinite(limits.maxPathBytes) ? { maxBufferBytes: limits.maxPathBytes } : {}),
    });
  }

  async read(directory: string): Promise<IgnoreFile[]> {
    const files: IgnoreFile[] = [];
    for (const name of [".cvsignore", ".gitignore", ".bzrignore", ".hgignore"]) {
      const path = resolvePath(directory, name);
      if (!await maybeStat(this.context, path)) continue;
      const bytes = await smallFile(this.context, path, this.limits);
      this.bytes += bytes.length;
      if (this.bytes > this.limits.maxFilesFromBytes) fail("VCS ignore file byte limit exceeded");
      const contents = text(bytes);
      if (contents.includes("\0")) fail("NUL in VCS ignore file");
      const file: IgnoreFile = { recursive: name !== ".cvsignore", rules: [] };
      let regex = name === ".hgignore";
      const lines = name === ".cvsignore" ? contents.split(/\s+/u) : contents.split("\n");
      for (let source of lines) {
        source = source.trimStart();
        if (!source || (name !== ".cvsignore" && source.startsWith("#"))) continue;
        if (name === ".hgignore" && source.startsWith("syntax:")) {
          const syntax = source.slice(7).trim();
          if (syntax === "glob" || syntax === "regexp") regex = syntax === "regexp";
          continue;
        }
        let include = false;
        if (name === ".bzrignore" && source.startsWith("!")) {
          source = source.slice(1);
          if (source.startsWith("!")) source = source.slice(1);
          else include = true;
        }
        const isRegex = regex || (name === ".bzrignore" && source.startsWith("RE:"));
        if (name === ".bzrignore" && isRegex) source = source.slice(3);
        if (name === ".hgignore" && source.endsWith("/")) source = source.slice(0, -1);
        checkPath(source, this.limits);
        if (++this.patterns > this.limits.maxMembers) fail("exclude pattern limit exceeded");
        file.rules.push({ include, pattern: isRegex ? new Pattern(source)
          : new Exclusions([source], this.work, true, true) });
      }
      files.push(file);
    }
    return files;
  }

  async matches(name: string, files: readonly IgnoreFile[]): Promise<boolean> {
    let relative = name;
    while (relative.startsWith("./")) relative = relative.slice(2);
    const candidates = [...new Set([name, relative, name.slice(name.lastIndexOf("/") + 1)])];
    for (const file of files) {
      let excluded = false;
      for (const rule of file.rules) {
        for (const candidate of candidates) {
          const matched = rule.pattern instanceof Exclusions ? rule.pattern.matches(candidate)
            : await rule.pattern.find(candidate, this.regexBudget) !== undefined;
          if (matched) { excluded = !rule.include; break; }
        }
      }
      if (excluded) return true;
    }
    return false;
  }
}
