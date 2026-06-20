import { color } from "../../components/color.js";
import { CANCEL } from "./cancel-symbol.js";
import { GLYPHS, symbol } from "./glyphs.js";
import { Prompt, type PromptOptions } from "./core.js";
import { limitOptions } from "./pagination.js";
import { findNonDisabled, type SelectOption } from "./select.js";
import type { Action } from "./keys.js";

export interface MultiselectOptions<Value> {
  message: string;
  options: Array<SelectOption<Value>>;
  initialValues?: Value[];
  required?: boolean;
  maxItems?: number;
  signal?: AbortSignal;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

class MultiselectPrompt<Value> extends Prompt<Value[]> {
  private readonly options: Array<SelectOption<Value>>;

  constructor(opts: MultiselectOptions<Value>) {
    if (opts.options.length === 0) {
      throw new Error("Multiselect prompt requires at least one option.");
    }
    if (opts.options.every((option) => option.disabled)) {
      throw new Error("Multiselect prompt requires at least one enabled option.");
    }

    const cursor = findNonDisabled(0, 1, opts.options);
    super({
      ...opts,
      initialValue: [...(opts.initialValues ?? [])],
      validate: (value) => {
        if (opts.required && (!value || value.length === 0)) {
          return "Please select at least one option.\nPress SPACE to select, ENTER to submit";
        }
        return undefined;
      },
      render: (prompt) => renderMultiselectPrompt(prompt as MultiselectPrompt<Value>, opts)
    } satisfies PromptOptions<Value[]>, false);
    this.options = opts.options;
    this._cursor = cursor;

    this.on("cursor", (action: Action) => {
      if (action === "up" || action === "left") {
        this._cursor = findNonDisabled(this._cursor - 1, -1, this.options);
      } else if (action === "down" || action === "right") {
        this._cursor = findNonDisabled(this._cursor + 1, 1, this.options);
      } else if (action === "space") {
        this.toggleFocused();
      }
    });
    this.on("key", (key: string) => {
      if (key === "a") {
        this.toggleAll();
      } else if (key === "i") {
        this.invert();
      }
    });
  }

  get visibleOptions(): Array<SelectOption<Value>> {
    return this.options;
  }

  private enabledOptions(): Array<SelectOption<Value>> {
    return this.options.filter((option) => !option.disabled);
  }

  private toggleFocused(): void {
    const option = this.options[this.cursor];
    if (!option || option.disabled) {
      return;
    }
    this.toggleValue(option.value);
  }

  private toggleValue(value: Value): void {
    const current = this.value ?? [];
    this.setValue(current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value]);
  }

  private toggleAll(): void {
    const enabledValues = this.enabledOptions().map((option) => option.value);
    const current = this.value ?? [];
    const allSelected = enabledValues.every((value) => current.includes(value));
    this.setValue(allSelected ? [] : enabledValues);
  }

  private invert(): void {
    const current = this.value ?? [];
    this.setValue(this.enabledOptions().map((option) => option.value).filter((value) => !current.includes(value)));
  }

  protected override promptNonTty(): Promise<Value[] | typeof CANCEL> {
    if (process.env.POE_NO_PROMPT === "1") {
      return Promise.resolve(this.value ?? []);
    }
    return super.promptNonTty();
  }
}

function hasValue<Value>(values: Value[] | undefined, value: Value): boolean {
  return (values ?? []).includes(value);
}

function renderOption<Value>(
  option: SelectOption<Value>,
  values: Value[] | undefined,
  active: boolean,
  submitted: boolean,
  cancelled: boolean
): string {
  const selected = hasValue(values, option.value);
  const hint = option.hint ? color.dim(` (${option.hint})`) : "";
  if (submitted) return color.dim(option.label);
  if (cancelled) return color.dim.strikethrough(option.label);
  if (option.disabled) return `${color.gray(GLYPHS.checkboxInactive)} ${color.gray.strikethrough(option.label)}${hint}`;
  if (selected) return `${color.green(GLYPHS.checkboxSelected)} ${active ? option.label : color.dim(option.label)}${hint}`;
  if (active) return `${color.cyan(GLYPHS.checkboxActive)} ${option.label}${hint}`;
  return `${color.dim(GLYPHS.checkboxInactive)} ${color.dim(option.label)}${hint}`;
}

function renderMultiselectPrompt<Value>(prompt: MultiselectPrompt<Value>, opts: MultiselectOptions<Value>): string {
  if (prompt.state === "submit" || prompt.state === "cancel") {
    const selectedOptions = prompt.visibleOptions.filter((option) => hasValue(prompt.value, option.value));
    const labels = selectedOptions.length > 3
      ? prompt.state === "submit"
        ? color.dim(`${selectedOptions.length} selected`)
        : color.dim.strikethrough(`${selectedOptions.length} selected`)
      : selectedOptions
        .map((option) => prompt.state === "submit" ? color.dim(option.label) : color.dim.strikethrough(option.label))
        .join(", ");
    const end = prompt.state === "submit" ? color.green(GLYPHS.barEnd) : color.red(GLYPHS.barEnd);
    return `${color.gray(GLYPHS.barStart)} ${symbol(prompt.state)} ${opts.message}\n${color.gray(GLYPHS.bar)}  ${labels}\n${end}`;
  }

  const lines = limitOptions({
    cursor: prompt.cursor,
    options: prompt.visibleOptions,
    output: opts.output ?? process.stdout,
    maxItems: opts.maxItems,
    columnPadding: 3,
    style: (option, active) => renderOption(option, prompt.value, active, false, false)
  }).map((line) => `${prompt.state === "error" ? color.yellow(GLYPHS.bar) : color.cyan(GLYPHS.bar)}  ${line}`);

  const body = [`${color.gray(GLYPHS.barStart)} ${symbol(prompt.state)} ${opts.message}`, ...lines];
  if (prompt.state === "error") {
    body.push(`${color.yellow(GLYPHS.barEnd)}  ${color.yellow(prompt.error)}`);
  } else {
    body.push(color.cyan(GLYPHS.barEnd));
  }
  return body.join("\n");
}

export function multiselectPrompt<Value>(opts: MultiselectOptions<Value>): Promise<Value[] | typeof CANCEL> {
  return new MultiselectPrompt(opts).prompt();
}
