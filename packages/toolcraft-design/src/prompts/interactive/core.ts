import { EventEmitter } from "node:events";
import * as readline from "node:readline";
import { graphemes } from "../../dashboard/terminal-width.js";
import { CANCEL } from "./cancel-symbol.js";
import { mapKey, type Action } from "./keys.js";
import { wrapFrame } from "./wrap.js";

const cursor = {
  hide: "\x1b[?25l",
  show: "\x1b[?25h",
  move: (x: number, y: number) => {
    let output = "";
    if (x < 0) output += `\x1b[${-x}D`;
    if (x > 0) output += `\x1b[${x}C`;
    if (y < 0) output += `\x1b[${-y}A`;
    if (y > 0) output += `\x1b[${y}B`;
    return output;
  }
};

const erase = {
  down: "\x1b[J"
};

export type PromptStateName = "initial" | "active" | "submit" | "cancel" | "error";

/**
 * Builds the non-TTY rejection message, naming the documented `--yes` flag for the
 * command being run and keeping `POE_NO_PROMPT=1` as the secondary CI alternative.
 */
export function nonTtyPromptMessage(argv: string[] = process.argv): string {
  const tokens: string[] = [];
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("-")) break;
    tokens.push(arg);
  }
  const retry = [...tokens, "--yes"].join(" ");
  return `Interactive prompt requires a TTY. Re-run with \`${retry}\` to accept defaults non-interactively, or set POE_NO_PROMPT=1 in CI.`;
}

export interface PromptState<Value> {
  state: PromptStateName;
  value: Value | undefined;
  error: string;
  cursor: number;
  userInput: string;
}

export interface PromptOptions<Value> {
  render: (state: Prompt<Value>) => string;
  initialValue?: Value;
  initialUserInput?: string;
  validate?: (value: Value | undefined) => string | Error | undefined;
  signal?: AbortSignal;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

type InputStream = NodeJS.ReadableStream & {
  isTTY?: boolean;
  destroyed?: boolean;
  readableEnded?: boolean;
  setRawMode?: (enabled: boolean) => void;
  unpipe?: () => void;
};

type KeyMeta = {
  name?: string;
  ctrl?: boolean;
};

export class Prompt<Value> extends EventEmitter {
  state: PromptStateName = "initial";
  value: Value | undefined;
  error = "";
  userInput = "";
  protected _cursor = 0;
  protected input: InputStream;
  protected output: NodeJS.WritableStream;
  private readonly renderFrame: (state: Prompt<Value>) => string;
  private readonly validate?: (value: Value | undefined) => string | Error | undefined;
  private readonly signal?: AbortSignal;
  private readonly trackValue: boolean;
  private previousFrame = "";
  private readlineInterface?: readline.Interface;
  private closed = false;

  constructor(opts: PromptOptions<Value>, trackValue = true) {
    super();
    this.input = (opts.input ?? process.stdin) as InputStream;
    this.output = opts.output ?? process.stdout;
    this.renderFrame = opts.render;
    this.validate = opts.validate;
    this.signal = opts.signal;
    this.value = opts.initialValue;
    this.trackValue = trackValue;
    this.userInput = opts.initialUserInput ?? "";
    this._cursor = this.userInput.length;
  }

  get cursor(): number {
    return this._cursor;
  }

  prompt(): Promise<Value | typeof CANCEL> {
    if (this.signal?.aborted) {
      this.state = "cancel";
      return Promise.resolve(CANCEL);
    }

    if (this.input.isTTY !== true) {
      return this.promptNonTty();
    }

    if (this.input.destroyed || this.input.readableEnded) {
      this.state = "cancel";
      return Promise.resolve(CANCEL);
    }

    return new Promise((resolve) => {
      const onSubmit = (value: Value | undefined) => resolve(value as Value);
      const onCancel = () => resolve(CANCEL);
      this.once("submit", onSubmit);
      this.once("cancel", onCancel);

      this.signal?.addEventListener("abort", this.onCancel, { once: true });

      this.readlineInterface = readline.createInterface({
        input: this.input,
        output: undefined,
        tabSize: 2,
        prompt: "",
        escapeCodeTimeout: 50,
        terminal: true
      });
      this.readlineInterface.once("close", this.onCancel);
      this.input.once("close", this.onCancel);
      readline.emitKeypressEvents(this.input, this.readlineInterface);
      this.readlineInterface.prompt();
      this.input.on("keypress", this.onKeypress);
      if (this.input.setRawMode) {
        this.input.setRawMode(true);
      }
      this.output.on("resize", this.render);
      this.render();
    });
  }

  protected promptNonTty(): Promise<Value | typeof CANCEL> {
    return Promise.reject(new Error(nonTtyPromptMessage()));
  }

  protected readNonTtyLine(): Promise<string> {
    return new Promise((resolve) => {
      const rl = readline.createInterface({ input: this.input, terminal: false });
      let settled = false;

      const settle = (value: string) => {
        if (settled) {
          return;
        }
        settled = true;
        rl.close();
        resolve(value);
      };

      rl.once("line", settle);
      rl.once("close", () => settle(rl.line));
    });
  }

  protected setValue(value: Value | undefined): void {
    this.value = value;
    this.emit("value", value);
  }

  protected setError(message: string): void {
    this.error = message;
  }

  protected setUserInput(value: string): void {
    this.userInput = value;
    this._cursor = Math.min(this._cursor, this.userInput.length);
    if (this.trackValue) {
      let boundary = 0;
      for (const segment of graphemes(value)) {
        if (boundary >= this._cursor) break;
        boundary += segment.length;
      }
      this._cursor = boundary;
    }
    this.emit("userInput", this.userInput);
  }

  protected clearUserInput(): void {
    this.userInput = "";
    this._cursor = 0;
    this.emit("userInput", this.userInput);
  }

  private readonly onCancel = () => {
    if (this.closed || this.state === "submit" || this.state === "cancel") {
      return;
    }

    this.state = "cancel";
    this.emit("finalize");
    this.render();
    this.close();
  };

  private readonly onKeypress = (char: string | undefined, key: KeyMeta = {}) => {
    if (this.closed) {
      return;
    }

    let action = mapKey(key.name, char);
    if (this.trackValue && char && char >= " " && key.name !== "return" && key.name !== "enter" && key.name !== "escape") {
      action = undefined;
    }

    if (this.trackValue && action !== "enter") {
      this.updateTrackedInput(char, key, action);
    }

    if (this.state === "error") {
      this.state = "active";
      this.error = "";
    }

    if (!this.trackValue && action) {
      this.emit("cursor", action);
    } else if (this.trackValue && action && action !== "enter") {
      this.emit("cursor", action);
    }

    if (char && /^[yn]$/i.test(char)) {
      this.emit("confirm", char.toLowerCase() === "y");
    }

    if (char) {
      this.emit("key", char.toLowerCase(), key);
    }

    if (action === "enter") {
      const error = this.validate?.(this.value);
      if (error) {
        this.error = error instanceof Error ? error.message : error;
        this.state = "error";
      } else {
        this.state = "submit";
      }
    }

    if (action === "cancel") {
      this.state = "cancel";
    }

    if (this.state === "submit" || this.state === "cancel") {
      this.emit("finalize");
    }

    this.render();

    if (this.state === "submit" || this.state === "cancel") {
      this.close();
    }
  };

  private updateTrackedInput(char: string | undefined, key: KeyMeta, action: Action | undefined): void {
    if (key.ctrl) {
      if (key.name === "a") {
        this._cursor = 0;
        return;
      }
      if (key.name === "e") {
        this._cursor = this.userInput.length;
        return;
      }
      if (key.name === "u") {
        const remaining = this.userInput.slice(this._cursor);
        this._cursor = 0;
        this.setUserInput(remaining);
        return;
      }
      if (key.name === "k") {
        this.setUserInput(this.userInput.slice(0, this._cursor));
        return;
      }
    }

    const before = this.userInput.slice(0, this._cursor);
    const after = this.userInput.slice(this._cursor);

    if (action === "left") {
      this._cursor -= graphemes(before).at(-1)?.length ?? 0;
      return;
    }
    if (action === "right") {
      this._cursor += graphemes(after)[0]?.length ?? 0;
      return;
    }
    if (action === "cancel" || action === "up" || action === "down" || action === "space") {
      return;
    }
    if (key.name === "backspace" || char === "\b" || char === "\x7f") {
      if (this._cursor > 0) {
        this._cursor -= graphemes(before).at(-1)?.length ?? 0;
        this.setUserInput(`${before.slice(0, this._cursor)}${after}`);
      }
      return;
    }
    if (key.name === "delete") {
      if (this._cursor < this.userInput.length) {
        this.setUserInput(`${before}${after.slice(graphemes(after)[0]?.length ?? 0)}`);
      }
      return;
    }
    if (!char || char < " " || key.ctrl) {
      return;
    }

    this._cursor += char.length;
    this.setUserInput(`${before}${char}${after}`);
  }

  protected readonly render = () => {
    if (this.closed) {
      return;
    }

    const frame = wrapFrame(this.output, this.renderFrame(this) ?? "");
    if (frame === this.previousFrame) {
      return;
    }

    if (!this.previousFrame) {
      this.output.write(`${cursor.hide}${frame}`);
      this.previousFrame = frame;
      if (this.state === "initial") {
        this.state = "active";
      }
      return;
    }

    const previousLineCount = this.previousFrame.split("\n").length - 1;
    this.output.write(`${cursor.move(-999, -previousLineCount)}${erase.down}${frame}`);
    this.previousFrame = frame;
  };

  protected close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.input.removeListener("keypress", this.onKeypress);
    this.input.removeListener("close", this.onCancel);
    this.output.removeListener("resize", this.render);
    this.signal?.removeEventListener("abort", this.onCancel);
    this.readlineInterface?.removeListener("close", this.onCancel);
    this.output.write(`${cursor.show}\n`);
    if (!process.platform.startsWith("win") && this.input.setRawMode) {
      this.input.setRawMode(false);
    }
    this.readlineInterface?.close();
    this.input.unpipe?.();

    if (this.state === "cancel") {
      this.emit("cancel");
    } else {
      this.emit("submit", this.value);
    }
    this.removeAllListeners();
  }
}
