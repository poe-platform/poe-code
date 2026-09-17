import { parse } from "shell-quote";
import { stripAnsi } from "toolcraft-design";

/** Presentation only: command text is parsed, never executed or expanded from process.env. */
export function summarizeToolAction(tool: { kind: string; title: string; input?: unknown }): {
  label: string;
  detail: string;
} {
  const input = tool.input && typeof tool.input === "object" ? tool.input as Record<string, unknown> : {};
  const detail = stringField(input, "command", "cmd") ?? tool.title;
  let label: string;
  if (tool.kind === "exec" || tool.kind === "execute") {
    label = summarizeCommand(detail);
  } else {
    const target = stringField(input, "file_path", "path", "pattern", "query") ?? tool.title;
    const verbs: Record<string, string> = {
      read: "Read", edit: "Edit", write: "Write", delete: "Delete", move: "Move",
      search: "Search", fetch: "Fetch", think: "Think", switch_mode: "Switch mode"
    };
    const query = tool.kind === "search" ? stringField(input, "pattern", "query") : undefined;
    const location = query ? stringField(input, "path") : undefined;
    label = `${verbs[tool.kind] ?? "Use"} ${query ?? target}${location ? ` in ${location}` : ""}`;
  }
  const clean = stripAnsi(label).split("\n").join(" ").split("\r").join(" ").trim();
  const characters = Array.from(clean);
  return { label: characters.length > 100 ? characters.slice(0, 99).join("") + "…" : clean, detail };
}

function stringField(input: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function summarizeCommand(source: string): string {
  try {
    let command = source;
    let tokens = parse(command, (name) => `$${name}`);
    for (let depth = 0; depth < 3; depth++) {
      const program = typeof tokens[0] === "string" ? basename(tokens[0]) : "";
      if (!["sh", "bash", "zsh", "dash", "ksh"].includes(program)) break;
      const flag = tokens.findIndex((token) => typeof token === "string" && token.startsWith("-") && token.includes("c"));
      if (flag < 0 || typeof tokens[flag + 1] !== "string") break;
      command = tokens[flag + 1] as string;
      tokens = parse(command, (name) => `$${name}`);
    }
    const program = typeof tokens[0] === "string" ? basename(tokens[0]) : "command";
    if (command.includes("\n")) return `Run ${program} script`;
    const groups: string[][][] = [[[]]];
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index]!;
      const pipeline = groups.at(-1)!;
      const words = pipeline.at(-1)!;
      if (typeof token === "string") words.push(token);
      else if ("op" in token && token.op === "|") pipeline.push([]);
      else if ("op" in token && [";", "&&", "||"].includes(token.op)) groups.push([[]]);
      else if ("op" in token && [">", ">>", ">&"].includes(token.op) && groups.length === 1 && pipeline.length === 1) {
        const action = summarizeWords(words);
        const redirectOnly = tokens.slice(index + 1).every((next) => typeof next === "string" || ("op" in next && [">", ">>", ">&"].includes(next.op)));
        return redirectOnly && action.startsWith("Run ") ? action : `Run ${command}`;
      } else return `Run ${command}`;
    }
    const actions = groups.filter((group) => group[0]!.length > 0).map((pipeline) => {
      const action = summarizeWords(pipeline[0]!);
      if (pipeline.length === 1) return action;
      const previewOnly = pipeline.slice(1).every((words) => {
        const program = basename(words[0] ?? "");
        if (["head", "tail"].includes(program)) return summarizeWords(words).startsWith("Run ");
        return program === "sort" && words.slice(1).every((word) => word.startsWith("-")
          && !word.startsWith("--output") && (word.startsWith("--") || !word.slice(1).includes("o")));
      });
      return previewOnly && ["Read ", "Search ", "List files"].some((verb) => action.startsWith(verb)) ? action : `Run ${command}`;
    });
    if (actions.length > 1 && actions.every((action) => action.startsWith("Read "))) {
      return `Read ${actions.map((action) => action.slice(5)).join(", ")}`;
    }
    if (actions.length === 1) return actions[0]!;
    return actions.length > 1 ? `${actions[0]} (+${actions.length - 1} commands)` : "Run command";
  } catch {
    return `Run ${source}`;
  }
}

function summarizeWords(words: string[]): string {
  const command = basename(words[0] ?? "");
  if (command === "git" && words[1] === "grep") return summarizeWords(["grep", ...words.slice(2)]);
  if (command === "git" && words[1] === "ls-files") return summarizeWords(["rg", "--files", ...words.slice(2)]);
  if (["cat", "head", "tail", "sed"].includes(command)) {
    const args: string[] = [];
    let options = true;
    let edit = false;
    let expression = false;
    for (let index = 1; index < words.length; index++) {
      const word = words[index]!;
      if (options && word === "--") { options = false; continue; }
      if (options && command === "sed") {
        if (word === "--in-place" || word.startsWith("--in-place=")) {
          edit = true;
          continue;
        }
        if (["-e", "--expression", "-f", "--file"].includes(word)) { expression = true; index++; continue; }
        if (word.startsWith("--expression=") || word.startsWith("--file=")) { expression = true; continue; }
        if (word.startsWith("-") && !word.startsWith("--")) {
          for (let flagIndex = 1; flagIndex < word.length; flagIndex++) {
            const flag = word[flagIndex];
            if (flag === "i") {
              edit = true;
              if (flagIndex === word.length - 1 && words[index + 1] === "") index++;
              break;
            }
            if (flag === "e" || flag === "f") {
              expression = true;
              if (flagIndex === word.length - 1) index++;
              break;
            }
          }
          continue;
        }
      }
      if (options && ["-n", "-c", "--lines", "--bytes"].includes(word) && command !== "sed") { index++; continue; }
      if (options && word.startsWith("-")) continue;
      args.push(word);
    }
    const files = command === "sed" && !expression ? args.slice(1) : args;
    if (files.length > 0) return `${edit ? "Edit" : "Read"} ${files.join(", ")}`;
  }
  if (command === "rg" || command === "grep") {
    const operands: string[] = [];
    let query: string | undefined;
    for (let index = 1; index < words.length; index++) {
      const word = words[index]!;
      if (word === "-e" || word === "--regexp") { query = words[++index]; continue; }
      if (["-g", "--glob", "-t", "--type", "-T", "--type-not", "-A", "-B", "-C", "--context", "-m", "--max-count", "--max-depth"].includes(word)) { index++; continue; }
      if (!word.startsWith("-")) operands.push(word);
    }
    if (words.includes("--files")) return `List files${operands.length > 0 ? ` in ${operands.join(", ")}` : ""}`;
    query ??= operands.shift();
    if (query) return `Search ${query}${operands.length > 0 ? ` in ${operands.join(", ")}` : ""}`;
  }
  if (command === "ls") {
    const paths = words.slice(1).filter((word) => !word.startsWith("-"));
    return `List files${paths.length ? ` in ${paths.join(", ")}` : ""}`;
  }
  return `Run ${words.join(" ")}`;
}

function basename(value: string): string {
  return value.split("/").at(-1) ?? value;
}
