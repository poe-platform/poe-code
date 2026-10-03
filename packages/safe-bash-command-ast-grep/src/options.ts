import { languageFor, type Language } from "@poe-code/ts-ast";
export interface Options {
  scan: boolean;
  pattern?: string;
  rewrite?: string;
  language?: Language;
  ruleFile?: string;
  inlineRules?: string;
  json?: "pretty" | "compact" | "stream";
  update: boolean;
  stdin: boolean;
  heading: boolean;
  before: number;
  after: number;
  globs: string[];
  paths: string[];
  help: boolean;
}
export function parseOptions(args: readonly string[]): Options {
  const out: Options = {
    scan: args[0] === "scan",
    update: false,
    stdin: false,
    heading: false,
    before: 0,
    after: 0,
    globs: [],
    paths: [],
    help: false
  };
  let positional = false;
  for (let i = args[0] === "scan" || args[0] === "run" ? 1 : 0; i < args.length; i++) {
    const arg = args[i]!;
    if (positional) {
      out.paths.push(arg);
      continue;
    }
    if (arg === "--") {
      positional = true;
      continue;
    }
    if (!arg.startsWith("-") || arg === "-") {
      out.paths.push(arg);
      continue;
    }
    const equal = arg.indexOf("=");
    const key = equal < 0 ? arg : arg.slice(0, equal);
    const value = () => {
      const v = equal < 0 ? args[++i] : arg.slice(equal + 1);
      if (v === undefined) throw new Error(`missing value for ${key}`);
      return v;
    };
    if (key === "-h" || key === "--help") out.help = true;
    else if (key === "-U" || key === "--update-all") out.update = true;
    else if (key === "--stdin") out.stdin = true;
    else if (key === "--json") {
      const v =
        equal >= 0
          ? value()
          : ["pretty", "compact", "stream"].includes(args[i + 1] ?? "")
            ? args[++i]!
            : "pretty";
      if (v !== "pretty" && v !== "compact" && v !== "stream")
        throw new Error("invalid JSON format");
      out.json = v;
    } else if (key === "--heading") {
      const v =
        equal >= 0
          ? value()
          : ["always", "never", "auto"].includes(args[i + 1] ?? "")
            ? args[++i]!
            : "always";
      if (!["always", "never", "auto"].includes(v)) throw new Error("invalid heading mode");
      out.heading = v === "always";
    } else if (key === "-p" || key === "--pattern") out.pattern = value();
    else if (key === "-r" || key === "--rewrite" || key === "--rule") {
      if (out.scan) out.ruleFile = value();
      else out.rewrite = value();
    } else if (key === "--inline-rules") out.inlineRules = value();
    else if (key === "-l" || key === "--lang") out.language = languageFor(value().toLowerCase());
    else if (key === "--globs") out.globs.push(value());
    else if (["-A", "--after", "-B", "--before", "-C", "--context"].includes(key)) {
      const v = Number(value());
      if (!Number.isSafeInteger(v) || v < 0) throw new Error("invalid context count");
      if (["-A", "--after", "-C", "--context"].includes(key)) out.after = v;
      if (["-B", "--before", "-C", "--context"].includes(key)) out.before = v;
    } else throw new Error(`unknown option: ${key}`);
  }
  if (out.help) return out;
  if (out.scan ? !out.ruleFile && !out.inlineRules : out.pattern === undefined)
    throw new Error(out.scan ? "scan requires --rule or --inline-rules" : "run requires --pattern");
  if (out.scan && (out.pattern !== undefined || out.language !== undefined))
    throw new Error("scan language and patterns belong in rules");
  if (!out.scan && (out.ruleFile || out.inlineRules)) throw new Error("rule files require scan");
  if (out.stdin && out.paths.length) throw new Error("--stdin cannot be combined with paths");
  if (out.stdin && !out.scan && !out.language) throw new Error("--stdin requires --lang");
  if (out.stdin && out.update) throw new Error("--update-all requires files");
  if (out.update && !out.scan && out.rewrite === undefined)
    throw new Error("--update-all requires --rewrite");
  return out;
}
export const help = `Usage: ast-grep [run] -p PATTERN [-r REWRITE] [-l LANG] [PATH ...]
       ast-grep scan [-r RULE.yml] [--inline-rules YAML] [PATH ...]
Aliases: sg
Languages: ts, tsx, js, jsx, json, yaml, html, css
--json[=pretty|compact|stream]  Emit structural matches as JSON
-U, --update-all               Apply rewrites to virtual files
--stdin                       Search stdin (run requires --lang)
--globs GLOB                  Include glob, or !GLOB to exclude (repeatable)
--heading[=always|never|auto]   Group text matches by file
-A N / -B N / -C N             Lines after / before / around matches
Exit status: 0 matches, 1 no matches, 2 invalid arguments or execution error.
`;
