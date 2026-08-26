import { color } from "../../components/color.js";
import { graphemes } from "../../dashboard/terminal-width.js";
import { GLYPHS, symbol, symbolBar } from "./glyphs.js";
import { CANCEL } from "./cancel-symbol.js";
import { Prompt } from "./core.js";
import { wrapTextWithPrefix } from "./wrap.js";

export interface TextOptions {
  message: string;
  placeholder?: string;
  defaultValue?: string;
  initialValue?: string;
  validate?: (value: string) => string | Error | undefined;
  signal?: AbortSignal;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

class TextPrompt extends Prompt<string> {
  constructor(opts: TextOptions) {
    const initialUserInput = opts.initialValue ?? "";
    super({
      ...opts,
      initialValue: initialUserInput,
      initialUserInput,
      render: (prompt) => renderTextPrompt(prompt as TextPrompt, opts),
      validate: (value) => opts.validate?.(value || opts.defaultValue || "")
    });
    this.on("userInput", (value: string) => this.setValue(value));
    this.on("finalize", () => {
      if (this.state === "submit") {
        this.setValue(this.value || opts.defaultValue || "");
      }
    });
  }

  get userInputWithCursor(): string {
    if (this.state === "submit") {
      return this.userInput;
    }

    const before = this.userInput.slice(0, this.cursor);
    const current = graphemes(this.userInput.slice(this.cursor))[0];
    const after = this.userInput.slice(this.cursor + (current?.length ?? 0));

    if (current) {
      return `${before}${color.inverse(current)}${after}`;
    }
    return `${before}${color.inverse("█")}`;
  }

  protected override promptNonTty(): Promise<string | typeof CANCEL> {
    return this.readNonTtyLine();
  }
}

function renderHeader(prompt: Prompt<string>, message: string): string {
  return `${color.gray(GLYPHS.barStart)} ${symbol(prompt.state)} ${message}`;
}

function renderTextPrompt(prompt: TextPrompt, opts: TextOptions): string {
  const value = prompt.value ?? "";
  if (prompt.state === "submit") {
    return `${renderHeader(prompt, opts.message)}\n${wrapTextWithPrefix(opts.output ?? process.stdout, color.dim(value), `${color.gray(GLYPHS.bar)}  `)}\n${color.green(GLYPHS.barEnd)}`;
  }
  if (prompt.state === "cancel") {
    return `${renderHeader(prompt, opts.message)}\n${wrapTextWithPrefix(opts.output ?? process.stdout, color.dim.strikethrough(value), `${color.gray(GLYPHS.bar)}  `)}\n${color.red(GLYPHS.barEnd)}`;
  }

  const [placeholder, ...placeholderRest] = graphemes(opts.placeholder ?? "");
  const input = prompt.userInput.length > 0
    ? prompt.userInputWithCursor
    : placeholder
      ? `${color.inverse(placeholder)}${color.dim(placeholderRest.join(""))}`
      : color.inverse("_");

  if (prompt.state === "error") {
    return `${renderHeader(prompt, opts.message)}\n${wrapTextWithPrefix(opts.output ?? process.stdout, input, `${symbolBar(prompt.state)}  `)}\n${color.yellow(GLYPHS.barEnd)}  ${color.yellow(prompt.error)}`;
  }

  return `${renderHeader(prompt, opts.message)}\n${wrapTextWithPrefix(opts.output ?? process.stdout, input, `${symbolBar(prompt.state)}  `)}\n${color.cyan(GLYPHS.barEnd)}`;
}

export function textPrompt(opts: TextOptions): Promise<string | typeof CANCEL> {
  return new TextPrompt(opts).prompt();
}
