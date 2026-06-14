import { color } from "../../components/color.js";
import { CANCEL } from "./cancel-symbol.js";
import { GLYPHS, symbol, symbolBar } from "./glyphs.js";
import { Prompt, type PromptOptions } from "./core.js";

export interface PasswordOptions {
  message: string;
  mask?: string;
  validate?: (value: string) => string | Error | undefined;
  signal?: AbortSignal;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

class PasswordPrompt extends Prompt<string> {
  private readonly mask: string;

  constructor(opts: PasswordOptions) {
    super({
      ...opts,
      initialValue: "",
      initialUserInput: "",
      render: (prompt) => renderPasswordPrompt(prompt as PasswordPrompt, opts),
      validate: opts.validate as PromptOptions<string>["validate"]
    });
    this.mask = opts.mask ?? GLYPHS.passwordMask;
    this.on("userInput", (value: string) => this.setValue(value));
  }

  get masked(): string {
    return this.mask.repeat(this.userInput.length);
  }

  get userInputWithCursor(): string {
    if (this.state === "submit") {
      return this.masked;
    }

    const masked = this.masked;
    const before = masked.slice(0, this.cursor);
    const current = masked[this.cursor];
    const after = masked.slice(this.cursor + 1);

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

function renderPasswordPrompt(prompt: PasswordPrompt, opts: PasswordOptions): string {
  const value = prompt.masked;
  if (prompt.state === "submit") {
    return `${renderHeader(prompt, opts.message)}\n${color.gray(GLYPHS.bar)}  ${color.dim(value)}\n${color.green(GLYPHS.barEnd)}`;
  }
  if (prompt.state === "cancel") {
    return `${renderHeader(prompt, opts.message)}\n${color.gray(GLYPHS.bar)}  ${color.dim.strikethrough(value)}\n${color.red(GLYPHS.barEnd)}`;
  }
  if (prompt.state === "error") {
    return `${renderHeader(prompt, opts.message)}\n${symbolBar(prompt.state)}  ${prompt.userInputWithCursor}\n${color.yellow(GLYPHS.barEnd)}  ${color.yellow(prompt.error)}`;
  }
  return `${renderHeader(prompt, opts.message)}\n${symbolBar(prompt.state)}  ${prompt.userInputWithCursor}\n${color.cyan(GLYPHS.barEnd)}`;
}

export function passwordPrompt(opts: PasswordOptions): Promise<string | typeof CANCEL> {
  return new PasswordPrompt(opts).prompt();
}
