import {createRequire} from "node:module";
import {createComponentPolicy} from "./component-host.js";
import {confirmPrompt} from "./prompt-confirm.js";
import {multiselectPrompt} from "./prompt-multiselect.js";
import {passwordPrompt} from "./prompt-password.js";
import {selectPrompt} from "./prompt-select.js";
import {textPrompt} from "./prompt-text.js";
import {cancel, isCancel} from "./prompt-cancel-primitive.js";
export {cancel, isCancel};
export {intro, introPlain, outro, log} from "./prompt-output.js";
export {note} from "./note.js";
export {spinner} from "./spinner.js";
export {withSpinner} from "./with-spinner.js";

const native = createRequire(import.meta.url)("./toolcraft-design-rust.node");
const invoke = createComponentPolicy(native.designPromptComponentsPolicy, {
  isCancel: value => !!isCancel(value),
  cancel: message => cancel(message),
  cancelled() {throw new PromptCancelledError();},
  true: () => true, false: () => false
});
export async function select(opts) {return selectPrompt(opts);}
export async function multiselect(opts) {return multiselectPrompt(opts);}
export async function text(opts) {return textPrompt(opts);}
export async function confirm(opts) {return confirmPrompt(opts);}
export class PromptCancelledError extends Error {
  constructor(message = "Operation cancelled.") {
    super(message);
    this.name = "PromptCancelledError";
    if (Error.captureStackTrace) Error.captureStackTrace(this, this.constructor);
  }
}
export async function confirmOrCancel(opts) {return invoke("confirmResult", [await confirm(opts)]);}
export async function password(opts) {return passwordPrompt(opts);}
