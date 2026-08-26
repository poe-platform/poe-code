import { color } from "../../components/color.js";
import { CANCEL } from "./cancel-symbol.js";
import { GLYPHS, symbol } from "./glyphs.js";
import { Prompt } from "./core.js";
import { limitOptions } from "./pagination.js";
import type { Action } from "./keys.js";

export interface SelectOption<Value> {
  value: Value;
  label: string;
  hint?: string;
  disabled?: boolean;
}

export interface SelectOptions<Value> {
  message: string;
  options: Array<SelectOption<Value>>;
  initialValue?: Value;
  maxItems?: number;
  signal?: AbortSignal;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

class SelectPrompt<Value> extends Prompt<Value> {
  private readonly options: Array<SelectOption<Value>>;

  constructor(opts: SelectOptions<Value>) {
    if (opts.options.length === 0) {
      throw new Error("Select prompt requires at least one option.");
    }
    if (opts.options.every((option) => option.disabled)) {
      throw new Error("Select prompt requires at least one enabled option.");
    }

    const initialIndex = Math.max(opts.options.findIndex((option) => option.value === opts.initialValue), 0);
    const cursor = findNonDisabled(initialIndex, 1, opts.options);
    super({
      ...opts,
      initialValue: opts.options[cursor]?.value,
      render: (prompt) => renderSelectPrompt(prompt as SelectPrompt<Value>, opts)
    }, false);
    this.options = opts.options;
    this._cursor = cursor;
    this.setValue(this.options[this._cursor]?.value);

    this.on("cursor", (action: Action) => {
      if (action === "up" || action === "left") {
        this._cursor = findNonDisabled(this._cursor - 1, -1, this.options);
      } else if (action === "down" || action === "right") {
        this._cursor = findNonDisabled(this._cursor + 1, 1, this.options);
      }
      this.setValue(this.options[this._cursor]?.value);
    });
  }

  get visibleOptions(): Array<SelectOption<Value>> {
    return this.options;
  }

  protected override promptNonTty(): Promise<Value | typeof CANCEL> {
    if (process.env.POE_NO_PROMPT === "1") {
      return Promise.resolve(this.value as Value);
    }
    return super.promptNonTty();
  }
}

export function findNonDisabled<Value>(
  start: number,
  direction: 1 | -1,
  options: Array<SelectOption<Value>>
): number {
  if (options.every((option) => option.disabled)) {
    return start;
  }

  let index = start;
  for (let checked = 0; checked < options.length; checked += 1) {
    index = (index + options.length) % options.length;
    if (!options[index]?.disabled) {
      return index;
    }
    index += direction;
  }

  return start;
}

function renderOption<Value>(option: SelectOption<Value>, active: boolean, submitted: boolean, cancelled: boolean): string {
  const hint = option.hint ? color.dim(` (${option.hint})`) : "";
  if (submitted) return color.dim(option.label);
  if (cancelled) return color.dim.strikethrough(option.label);
  if (option.disabled) return `${color.gray(GLYPHS.radioInactive)} ${color.gray.strikethrough(option.label)}${hint}`;
  if (active) return `${color.green(GLYPHS.radioActive)} ${option.label}${hint}`;
  return `${color.dim(GLYPHS.radioInactive)} ${color.dim(option.label)}${hint}`;
}

function renderSelectPrompt<Value>(prompt: SelectPrompt<Value>, opts: SelectOptions<Value>): string {
  if (prompt.state === "submit" || prompt.state === "cancel") {
    const option = prompt.visibleOptions[prompt.cursor];
    const rendered = option ? renderOption(option, false, prompt.state === "submit", prompt.state === "cancel") : "";
    const end = prompt.state === "submit" ? color.green(GLYPHS.barEnd) : color.red(GLYPHS.barEnd);
    return `${color.gray(GLYPHS.barStart)} ${symbol(prompt.state)} ${opts.message}\n${color.gray(GLYPHS.bar)}  ${rendered}\n${end}`;
  }

  const lines = limitOptions({
    cursor: prompt.cursor,
    options: prompt.visibleOptions,
    output: opts.output ?? process.stdout,
    maxItems: opts.maxItems,
    columnPadding: 3,
    style: (option, active) => renderOption(option, active, false, false)
  }).flatMap((line) => line.split("\n").map((physicalLine) => `${color.cyan(GLYPHS.bar)}  ${physicalLine}`));

  return `${color.gray(GLYPHS.barStart)} ${symbol(prompt.state)} ${opts.message}\n${lines.join("\n")}\n${color.cyan(GLYPHS.barEnd)}`;
}

export function selectPrompt<Value>(opts: SelectOptions<Value>): Promise<Value | typeof CANCEL> {
  return new SelectPrompt(opts).prompt();
}
