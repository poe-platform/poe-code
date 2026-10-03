import {
  parseCode,
  findMatches,
  applyEdits,
  languageFor,
  type Match,
  type Edit,
  type Language
} from "@poe-code/ts-ast";
import picomatch from "picomatch";
import {
  commandRuntimeIdentity,
  getCommandArguments,
  collectBytes,
  pathOf,
  normalizePath,
  relativePath,
  writeBytes,
  writeText,
  writeFileOutput,
  type CommandDefinition,
  type VirtualShellPlugin
} from "safe-bash-contracts";
import { createOutputOperation } from "safe-bash-contracts/output";
import { inheritYieldCheckpoint, yieldTurn } from "safe-bash-contracts/yield";
import { parseOptions, help, type Options } from "./options.js";
import { parseRules, type SearchRule } from "./rules.js";
export interface AstGrepLimits {
  maxInputBytes: number;
  maxOutputBytes: number;
  maxFiles: number;
  maxMatches: number;
  maxDirectoryEntries: number;
}
export interface AstGrepCommandsOptions extends Partial<AstGrepLimits> {
  limits?: Partial<AstGrepLimits>;
  replace?: boolean;
}
const encoder = new TextEncoder();
function settings(options: AstGrepCommandsOptions): AstGrepLimits {
  const limits: AstGrepLimits = {
    maxInputBytes: 8 * 1024 * 1024,
    maxOutputBytes: 16 * 1024 * 1024,
    maxFiles: 10000,
    maxMatches: 10000,
    maxDirectoryEntries: 50000
  };
  for (const key of Object.keys(limits) as (keyof AstGrepLimits)[]) {
    limits[key] = options.limits?.[key] ?? options[key] ?? limits[key];
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1)
      throw new RangeError(`invalid ${key}`);
  }
  return limits;
}
function replacement(template: string, match: Match): string {
  let result = "";
  for (let i = 0; i < template.length; ) {
    if (template[i] !== "$") {
      result += template[i++];
      continue;
    }
    const start = i;
    const prefix = template.startsWith("$$$", i) ? 3 : 1;
    let end = i + prefix;
    const first = template[end] ?? "";
    if (!first || !(first === "_" || (first >= "A" && first <= "Z"))) {
      result += template[i++];
      continue;
    }
    while (end < template.length) {
      const c = template[end]!;
      if (!(c === "_" || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9"))) break;
      end++;
    }
    const name = template.slice(i + prefix, end),
      capture = match.captures[name];
    if (!capture) throw new Error(`Unknown rewrite capture: ${template.slice(start, end)}`);
    result += capture.text;
    i = end;
  }
  return result;
}
function record(match: Match, file: string, lines: readonly string[], rule: SearchRule) {
  const node = match.node;
  const capture = (m: { text: string; range: [number, number] }) => ({
    text: m.text,
    range: { byteOffset: { start: m.range[0], end: m.range[1] } }
  });
  const single: Record<string, unknown> = {},
    multi: Record<string, unknown> = {};
  for (const [name, c] of Object.entries(match.captures)) {
    if (c.nodes.length === 1) single[name] = capture(c);
    else multi[name] = c.nodes.map(capture);
  }
  const result = {
    text: node.text,
    range: {
      byteOffset: { start: node.range[0], end: node.range[1] },
      start: node.start,
      end: node.end
    },
    file,
    lines: lines.slice(node.start.line, node.end.line + 1).join("\n"),
    language: node.language,
    metaVariables: { single, multi },
    ...(rule.id
      ? { ruleId: rule.id, message: rule.message ?? "", severity: rule.severity ?? "warning" }
      : {}),
    ...(rule.fix !== undefined ? { replacement: replacement(rule.fix, match) } : {})
  };
  return result;
}
function textOutput(source: string, file: string, matches: Match[], options: Options): string {
  const lines = source.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const matched = new Set<number>(),
    shown = new Set<number>();
  for (const { node } of matches) {
    const end =
      node.end.column === 0 && node.end.line > node.start.line ? node.end.line - 1 : node.end.line;
    for (let n = node.start.line; n <= end; n++) matched.add(n);
    for (
      let n = Math.max(0, node.start.line - options.before);
      n <= Math.min(lines.length - 1, end + options.after);
      n++
    )
      shown.add(n);
  }
  let output = options.heading ? file + "\n" : "";
  let previous = -1;
  for (const n of [...shown].sort((a, b) => a - b)) {
    if (previous >= 0 && n > previous + 1) output += "--\n";
    const separator = matched.has(n) ? ":" : "-";
    output += (options.heading ? "" : file + separator) + (n + 1) + separator + lines[n] + "\n";
    previous = n;
  }
  return output;
}
export function createAstGrepCommand(options: AstGrepCommandsOptions = {}): CommandDefinition {
  const limits = settings(options);
  return {
    name: "ast-grep",
    description: "Search and rewrite syntax in virtual files",
    runtimeIdentity: commandRuntimeIdentity,
    async execute(context) {
      context.signal.throwIfAborted();
      const operation = createOutputOperation(context, { write: async () => {} });
      inheritYieldCheckpoint(context.signal, operation.signal);
      context = {
        ...context,
        signal: operation.signal,
        stdout: operation.child(context.stdout).output
      };
      try {
        const opts = parseOptions(getCommandArguments(context).args);
        if (opts.help) {
          await writeText(context.stdout, help);
          return { exitCode: 0 };
        }
        let inputBytes = 0,
          outputBytes = 0,
          files = 0,
          entries = 0,
          count = 0;
        const output = async (text: string) => {
          const bytes = encoder.encode(text);
          outputBytes += bytes.length;
          if (outputBytes > limits.maxOutputBytes) throw new Error("output byte limit exceeded");
          await writeBytes(context.stdout, bytes, context.signal);
        };
        const read = async (path?: string) => {
          const remaining = limits.maxInputBytes - inputBytes;
          const bytes =
            path === undefined
              ? await collectBytes(context.stdin, { maxBytes: remaining, signal: context.signal })
              : await context.fs.readFile(path, { maxBytes: remaining, signal: context.signal });
          inputBytes += bytes.length;
          if (inputBytes > limits.maxInputBytes) throw new Error("input byte limit exceeded");
          return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
        };
        let rules: SearchRule[];
        if (opts.scan) {
          rules = [];
          if (opts.ruleFile) rules.push(...parseRules(await read(pathOf(context, opts.ruleFile))));
          if (opts.inlineRules) {
            inputBytes += encoder.encode(opts.inlineRules).length;
            if (inputBytes > limits.maxInputBytes) throw new Error("input byte limit exceeded");
            rules.push(...parseRules(opts.inlineRules));
          }
          if (!rules.length) throw new Error("no rules");
        } else
          rules = [
            {
              rule: opts.pattern!,
              ...(opts.language ? { language: opts.language } : {}),
              ...(opts.rewrite !== undefined ? { fix: opts.rewrite } : {})
            }
          ];
        const includes = opts.globs
          .filter((g) => !g.startsWith("!"))
          .map((g) => picomatch(g, { dot: true, basename: !g.includes("/") }));
        const excludes = opts.globs
          .filter((g) => g.startsWith("!"))
          .map((g) => picomatch(g.slice(1), { dot: true, basename: !g.includes("/") }));
        const seen = new Set<string>();
        async function* paths(): AsyncGenerator<string | undefined> {
          if (opts.stdin) {
            yield undefined;
            return;
          }
          const pending = (opts.paths.length ? opts.paths : ["."])
            .map((p) => normalizePath(pathOf(context, p)))
            .reverse();
          while (pending.length) {
            await yieldTurn(context.signal);
            const path = pending.pop()!;
            if (seen.has(path)) continue;
            seen.add(path);
            if (++entries > limits.maxDirectoryEntries)
              throw new Error("directory entry limit exceeded");
            const stat = await context.fs.lstat(path, { signal: context.signal });
            if (stat.type === "directory") {
              const children = await context.fs.readdir(path, {
                signal: context.signal,
                maxEntries: limits.maxDirectoryEntries - entries
              });
              if (entries + pending.length + children.length > limits.maxDirectoryEntries)
                throw new Error("directory entry limit exceeded");
              for (const child of children.sort((a, b) => b.name.localeCompare(a.name)))
                pending.push(normalizePath(path + "/" + child.name));
            } else if (stat.type === "file") {
              const relative = relativePath(context.cwd, path);
              if (
                (!includes.length || includes.some((g) => g(relative))) &&
                !excludes.some((g) => g(relative))
              )
                yield path;
            }
          }
        }
        if (opts.json && opts.json !== "stream") await output(opts.json === "pretty" ? "[\n" : "[");
        for await (const path of paths()) {
          let language: Language | undefined = opts.language;
          if (path && !language) {
            try {
              language = languageFor(path);
            } catch {
              continue;
            }
          }
          const relevant = rules.filter((r) => !path || !r.language || r.language === language);
          if (!relevant.length) continue;
          if (++files > limits.maxFiles) throw new Error("file limit exceeded");
          const source = await read(path),
            file = path ? relativePath(context.cwd, path) : "STDIN";
          const lines = source.split("\n");
          const edits: Edit[] = [];
          const allMatches: Match[] = [];
          for (const rule of relevant) {
            await yieldTurn(context.signal);
            const tree = parseCode(source, rule.language ?? language!);
            const matches = findMatches(tree, rule.rule);
            let end = -1;
            for (const match of matches) {
              if (++count > limits.maxMatches) throw new Error("match limit exceeded");
              const row = record(match, file, lines, rule);
              if (opts.json)
                await output(
                  (opts.json === "stream"
                    ? ""
                    : count > 1
                      ? opts.json === "compact"
                        ? ","
                        : ",\n"
                      : "") +
                    JSON.stringify(row, null, opts.json === "pretty" ? 2 : undefined) +
                    (opts.json === "stream" ? "\n" : "")
                );
              if (row.replacement !== undefined && match.node.range[0] >= end) {
                edits.push({ range: match.node.range, replacement: row.replacement });
                end = match.node.range[1];
              }
              allMatches.push(match);
            }
          }
          if (!opts.json && allMatches.length) {
            await output(textOutput(source, file, allMatches, opts));
            if (edits.length)
              await output(applyEdits(source, edits) + (source.endsWith("\n") ? "" : "\n"));
          }
          if (opts.update && path && edits.length) {
            const bytes = encoder.encode(applyEdits(source, edits));
            outputBytes += bytes.length;
            if (outputBytes > limits.maxOutputBytes) throw new Error("output byte limit exceeded");
            await writeFileOutput(context, bytes, (data) =>
              context.fs.writeFile(path, data, { signal: context.signal })
            );
          }
        }
        if (opts.json && opts.json !== "stream")
          await output(opts.json === "pretty" ? "\n]\n" : "]\n");
        return { exitCode: count ? 0 : 1 };
      } catch (error) {
        context.signal.throwIfAborted();
        await writeText(
          context.stderr,
          `${context.command}: ${error instanceof Error ? error.message : String(error)}\n`
        );
        return { exitCode: 2 };
      } finally {
        await operation.close();
      }
    }
  };
}
export function createAstGrepCommands(
  options: AstGrepCommandsOptions = {}
): readonly CommandDefinition[] {
  const command = createAstGrepCommand(options);
  return [command, { ...command, name: "sg" }];
}
export function astGrepCommands(options: AstGrepCommandsOptions = {}): VirtualShellPlugin {
  const commands = createAstGrepCommands(options);
  return {
    name: "ast-grep-commands",
    setup(host) {
      if (!options.replace)
        for (const command of commands)
          if (host.commands.has(command.name))
            throw new Error(`Command already registered: ${command.name}`);
      for (const command of commands)
        host.commands.register(command, { replace: options.replace ?? false });
    }
  };
}
