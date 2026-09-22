import { HtmlBudget, HtmlError, type HtmlOptions } from "./contracts.js";
export interface HtmlqArguments {
  readonly selector: string;
  readonly filename: string;
  readonly output: string;
  readonly base: string;
  readonly detectBase: boolean;
  readonly text: boolean;
  readonly ignoreWhitespace: boolean;
  readonly pretty: boolean;
  readonly attributes: readonly string[];
  readonly removeNodes: readonly string[];
}
export function parseHtmlqArguments(argv: readonly string[], options: HtmlOptions): HtmlqArguments {
  const budget = new HtmlBudget(options);
  const result = {
    selector: "html",
    filename: "-",
    output: "-",
    base: "",
    detectBase: false,
    text: false,
    ignoreWhitespace: false,
    pretty: false,
    attributes: [] as string[],
    removeNodes: [] as string[]
  };
  let positional = false,
    literal = false;
  const seen = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i]!;
    budget.charge("work", arg.length + 1);
    budget.charge("retainedBytes", arg.length * 2 + 32);
    budget.bound("tokenBytes", arg.length * 2);
    if (!literal && arg === "--") {
      literal = true;
      continue;
    }
    if (!literal && arg.startsWith("-") && arg !== "-") {
      let attached: string | undefined;
      const equal = arg.indexOf("=");
      if (equal >= 0 && arg.startsWith("--")) {
        attached = arg.slice(equal + 1);
        arg = arg.slice(0, equal);
      }
      const short = !arg.startsWith("--");
      const option = arg;
      for (let offset = short ? 1 : 0; offset < option.length; offset++) {
        arg = short ? `-${option[offset]}` : option;
        const key = (
          {
            "-f": "filename",
            "--filename": "filename",
            "-o": "output",
            "--output": "output",
            "-b": "base",
            "--base": "base",
            "-a": "attributes",
            "--attributes": "attributes",
            "-r": "removeNodes",
            "--remove-nodes": "removeNodes"
          } as Record<string, "filename" | "output" | "base" | "attributes" | "removeNodes">
        )[arg];
        if (key) {
          if (key !== "attributes" && key !== "removeNodes") {
            if (seen.has(key)) throw new HtmlError("E_ARGUMENT", `Repeated option ${arg}`);
            seen.add(key);
          }
          const remainder =
            short && offset + 1 < option.length
              ? option.slice(offset + (option[offset + 1] === "=" ? 2 : 1))
              : undefined;
          const separate = attached === undefined && remainder === undefined;
          const value = attached ?? remainder ?? argv[++i];
          if (value === undefined) throw new HtmlError("E_ARGUMENT", `Missing value for ${arg}`);
          if (separate && value.startsWith("-") && value !== "-")
            throw new HtmlError("E_ARGUMENT", `Missing value for ${arg}`);
          budget.bound("tokenBytes", value.length * 2);
          budget.charge("work", value.length);
          budget.charge("retainedBytes", value.length * 2);
          if (key === "attributes" || key === "removeNodes") result[key].push(value);
          else result[key] = value;
          break;
        } else {
          const flag = (
            {
              "-B": "detectBase",
              "--detect-base": "detectBase",
              "-t": "text",
              "--text": "text",
              "-i": "ignoreWhitespace",
              "--ignore-whitespace": "ignoreWhitespace",
              "-p": "pretty",
              "--pretty": "pretty"
            } as Record<string, "detectBase" | "text" | "ignoreWhitespace" | "pretty">
          )[arg];
          if (!flag || attached !== undefined)
            throw new HtmlError("E_ARGUMENT", `Unknown option ${arg}`);
          if (seen.has(flag)) throw new HtmlError("E_ARGUMENT", `Repeated option ${arg}`);
          seen.add(flag);
          result[flag] = true;
        }
        if (!short) break;
      }
    } else {
      if (positional) throw new HtmlError("E_ARGUMENT", "Only one selector operand is accepted");
      result.selector = arg;
      positional = true;
    }
  }
  return Object.freeze({
    ...result,
    attributes: Object.freeze(result.attributes),
    removeNodes: Object.freeze(result.removeNodes)
  });
}
