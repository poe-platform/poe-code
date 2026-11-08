import {Prompt} from "./prompt-core.js";
import {invoke} from "./prompt-input-policy.js";
import {graphemes} from "./graphemes.js";
import {GLYPHS} from "./prompt-glyphs.js";
class PasswordPrompt extends Prompt {
  mask;
  constructor(opts) {
    super({...opts, initialValue: "", initialUserInput: "",
      render: prompt => invoke("passwordFrame", [prompt, opts]), validate: opts.validate});
    this.mask = opts.mask ?? GLYPHS.passwordMask;
    this.on("userInput", value => this.setValue(value));
  }
  get masked() {return this.mask.repeat(graphemes(this.userInput).length);}
  get userInputWithCursor() {return invoke("passwordCursor", [this]);}
  promptNonTty() {return this.readNonTtyLine();}
}
export function passwordPrompt(opts) {return new PasswordPrompt(opts).prompt();}
