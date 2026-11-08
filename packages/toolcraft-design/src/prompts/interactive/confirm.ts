import { color } from "../../components/color.js";
import { CANCEL } from "./cancel-symbol.js";
import { GLYPHS, symbol, symbolBar } from "./glyphs.js";
import { Prompt } from "./core.js";
import type { Action } from "./keys.js";

export interface ConfirmOptions {
  message: string;
  initialValue?: boolean;
  signal?: AbortSignal;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

class ConfirmPrompt extends Prompt<boolean> {
  constructor(opts: ConfirmOptions) {
    super({
      ...opts,
      initialValue: opts.initialValue ?? true,
      render: (prompt) => renderConfirmPrompt(prompt as ConfirmPrompt, opts)
    }, false);

    this.on("confirm", (value: boolean) => {
      this.setValue(value);
      this.state = "submit";
      this.emit("finalize");
      this.render();
      this.close();
    });
    this.on("cursor", (action: Action) => {
      if (action === "up" || action === "down" || action === "left" || action === "right") {
        this.setValue(!this.value);
      }
    });
  }

  protected override promptNonTty(): Promise<boolean | typeof CANCEL> {
    if (process.env.POE_NO_PROMPT === "1") {
      return Promise.resolve(this.value ?? true);
    }
    return super.promptNonTty();
  }
}

function choices(value: boolean | undefined): string {
  const yes = value ? `${color.green(GLYPHS.radioActive)} ${color.bold("Yes")}` : `${color.dim(GLYPHS.radioInactive)} ${color.dim("Yes")}`;
  const no = value ? `${color.dim(GLYPHS.radioInactive)} ${color.dim("No")}` : `${color.green(GLYPHS.radioActive)} ${color.bold("No")}`;
  return `${yes} ${color.dim("/")} ${no}`;
}

function renderConfirmPrompt(prompt: ConfirmPrompt, opts: ConfirmOptions): string {
  if (prompt.state === "submit") {
    return `${color.gray(GLYPHS.barStart)} ${symbol(prompt.state)} ${opts.message}\n${color.gray(GLYPHS.bar)}  ${color.dim(prompt.value ? "Yes" : "No")}\n${color.green(GLYPHS.barEnd)}`;
  }
  if (prompt.state === "cancel") {
    return `${color.gray(GLYPHS.barStart)} ${symbol(prompt.state)} ${opts.message}\n${color.gray(GLYPHS.bar)}  ${color.dim.strikethrough(prompt.value ? "Yes" : "No")}\n${color.red(GLYPHS.barEnd)}`;
  }
  return `${color.gray(GLYPHS.barStart)} ${symbol(prompt.state)} ${opts.message}\n${symbolBar(prompt.state)}  ${choices(prompt.value)}\n${color.cyan(GLYPHS.barEnd)}`;
}

export function confirmPrompt(opts: ConfirmOptions): Promise<boolean | typeof CANCEL> {
  return new ConfirmPrompt(opts).prompt();
}
