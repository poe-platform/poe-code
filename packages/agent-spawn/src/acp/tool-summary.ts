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
    label = verbs[tool.kind]
      ? `${verbs[tool.kind]} ${query ?? target}${location ? ` in ${location}` : ""}`
      : summarizeToolName(tool.title);
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

function summarizeToolName(title: string): string {
  const parts = title.startsWith("mcp__") ? title.slice(5).split("__") : title.split(".");
  if (parts.length < 2 || parts.some((part) => part.length === 0 || Array.from(part).some((character) =>
    !(character >= "a" && character <= "z") && !(character >= "A" && character <= "Z")
    && !(character >= "0" && character <= "9") && character !== "_" && character !== "-"))) return `Use ${title}`;
  const name = parts.pop()!;
  let label = "";
  for (const [index, character] of Array.from(name).entries()) {
    if (character === "_" || character === "-") label += " ";
    else {
      if (index > 0 && character >= "A" && character <= "Z" && name[index - 1]! >= "a" && name[index - 1]! <= "z") label += " ";
      label += character.toLowerCase();
    }
  }
  return `${label[0]!.toUpperCase()}${label.slice(1)} · ${parts.join(".")}`;
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
    if (actions.length === 1) return actions[0]!.startsWith("Run ") ? `Run ${command}` : actions[0]!;
    return actions.length > 1 ? `Run ${command}` : "Run command";
  } catch {
    return `Run ${source}`;
  }
}

function summarizeWords(words: string[]): string {
  const command = basename(words[0] ?? "");
  if (command === "git" && words[1] === "grep") return summarizeWords(["grep", ...words.slice(2)]);
  if (command === "git" && words[1] === "ls-files") return summarizeWords(["rg", "--files", ...words.slice(2)]);
  if (command === "sed") return summarizeSed(words) ?? `Run ${words.join(" ")}`;
  if (["cat", "head", "tail"].includes(command)) {
    const args: string[] = [];
    let options = true;
    for (let index = 1; index < words.length; index++) {
      const word = words[index]!;
      if (options && word === "--") { options = false; continue; }
      if (options && ["-n", "-c", "--lines", "--bytes"].includes(word)) { index++; continue; }
      if (options && word.startsWith("-")) continue;
      args.push(word);
    }
    if (args.length > 0) return `Read ${args.join(", ")}`;
  }
  if (command === "rg" || command === "grep") {
    return summarizeSearch(words) ?? `Run ${words.join(" ")}`;
  }
  if (command === "ls") {
    const paths = words.slice(1).filter((word) => !word.startsWith("-"));
    return `List files${paths.length ? ` in ${paths.join(", ")}` : ""}`;
  }
  return `Run ${words.join(" ")}`;
}

function summarizeSearch(words: string[]): string | undefined {
  const operands: string[] = [];
  const queries: string[] = [];
  const files: string[] = [];
  const grep = basename(words[0]!) === "grep";
  const shortArguments = grep ? "efABCmDd" : "efgtTABCmMjErd";
  let options = true;
  let list = false;
  for (let index = 1; index < words.length; index++) {
    const word = words[index]!;
    if (options && word === "--") { options = false; continue; }
    if (!options || !word.startsWith("-") || word === "-") { operands.push(word); continue; }
    if (word === "--files") { list = true; continue; }
    if (word.startsWith("--")) {
      const equals = word.indexOf("=");
      const name = equals < 0 ? word : word.slice(0, equals);
      if (grep && name === "--color") continue;
      if (["--regexp", "--file", "--glob", "--iglob", "--type", "--type-not", "--after-context", "--before-context", "--context",
        "--max-count", "--max-depth", "--max-columns", "--threads", "--encoding", "--include", "--exclude", "--exclude-dir",
        "--exclude-from", "--ignore-file", "--type-add", "--type-clear", "--replace", "--pre", "--pre-glob", "--sort", "--sortr",
        "--color", "--colors", "--engine", "--label", "--devices", "--directories", "--binary-files"].includes(name)) {
        const value = equals < 0 ? words[++index] : word.slice(equals + 1);
        if (value === undefined) return undefined;
        if (name === "--regexp") queries.push(value);
        if (name === "--file") files.push(value);
      }
      continue;
    }
    for (let flag = 1; flag < word.length; flag++) {
      const name = word[flag]!;
      if (!shortArguments.includes(name)) continue;
      const value = word.slice(flag + 1) || words[++index];
      if (value === undefined) return undefined;
      if (name === "e") queries.push(value);
      if (name === "f") files.push(value);
      break;
    }
  }
  const scope = operands.length > 0 ? ` in ${operands.join(", ")}` : "";
  if (list) return `List files${scope}`;
  if (queries.length === 0 && files.length === 0) {
    const query = operands.shift();
    if (query === undefined) return undefined;
    queries.push(query);
  }
  if (queries.some((query) => query.length === 0)) return undefined;
  const query = queries.join(", ");
  const patterns = files.length > 0 ? `${query ? ", patterns from" : "using"} ${files.join(", ")}` : "";
  return `Search ${query}${patterns}${operands.length > 0 ? ` in ${operands.join(", ")}` : ""}`;
}

function summarizeSed(words: string[]): string | undefined {
  const operands: string[] = [];
  const scripts: string[] = [];
  let options = true;
  let edit = false;
  let scriptFile = false;
  for (let index = 1; index < words.length; index++) {
    const word = words[index]!;
    if (!options || !word.startsWith("-")) { operands.push(word); continue; }
    if (word === "--") { options = false; continue; }
    if (["--quiet", "--silent", "--regexp-extended", "--unbuffered", "--separate", "--posix"].includes(word)) continue;
    if (word === "--in-place" || word.startsWith("--in-place=")) { edit = true; continue; }
    if (word === "--expression" || word.startsWith("--expression=")) {
      scripts.push(word === "--expression" ? words[++index] ?? "" : word.slice("--expression=".length));
      continue;
    }
    if (word === "--file" || word.startsWith("--file=")) {
      scriptFile = true;
      if (word === "--file") index++;
      continue;
    }
    if (word.startsWith("--")) return undefined;
    for (let flagIndex = 1; flagIndex < word.length; flagIndex++) {
      const flag = word[flagIndex]!;
      if ("nErsu".includes(flag)) continue;
      if (flag === "i") {
        edit = true;
        if (flagIndex === word.length - 1 && words[index + 1] === "") index++;
        break;
      }
      if (flag === "e" || flag === "f") {
        const value = word.slice(flagIndex + 1) || words[++index] || "";
        if (flag === "e") scripts.push(value);
        else scriptFile = true;
        break;
      }
      return undefined;
    }
  }
  if (scripts.length === 0 && !scriptFile) scripts.push(operands.shift() ?? "");
  if (operands.length === 0) return undefined;
  if (edit) return `Edit ${operands.join(", ")}`;
  if (scriptFile || !scripts.every((script) => {
    const expression = script.trim();
    if (!expression.endsWith("p")) return false;
    const range = expression.slice(0, -1);
    if (!range) return true;
    const addresses = range.split(",");
    return addresses.length <= 2 && addresses.every((address) => address === "$"
      || (address.length > 0 && Array.from(address).every((character) => character >= "0" && character <= "9")));
  })) return undefined;
  return `Read ${operands.join(", ")}`;
}

function basename(value: string): string {
  return value.split("/").at(-1) ?? value;
}
