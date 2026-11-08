import {Prompt} from "./prompt-core.js";
import {invoke} from "./prompt-input-policy.js";
class TextPrompt extends Prompt {
  constructor(opts) {
    const initialUserInput = opts.initialValue ?? "";
    super({...opts, initialValue: initialUserInput, initialUserInput,
      render: prompt => invoke("textFrame", [prompt, opts]),
      validate: value => opts.validate?.(invoke("defaultText", [value, opts]))});
    this.on("userInput", value => this.setValue(value));
    this.on("finalize", () => {invoke("textFinalize", [this, opts]);});
  }
  get userInputWithCursor() {return invoke("textCursor", [this]);}
  promptNonTty() {return this.readNonTtyLine();}
}
export function textPrompt(opts) {return new TextPrompt(opts).prompt();}
