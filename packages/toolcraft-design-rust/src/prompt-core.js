import {EventEmitter} from "node:events";
import {invoke} from "./prompt-policy.js";
export function nonTtyPromptMessage(argv = process.argv) {return invoke("nonTtyPromptMessage",[argv]);}
export class Prompt extends EventEmitter {
    state = "initial";
    value;
    error = "";
    userInput = "";
    _cursor = 0;
    input;
    output;
    renderFrame;
    validate;
    signal;
    trackValue;
    previousFrame = "";
    readlineInterface;
    closed = false;
    constructor(opts, trackValue = true) {
        super();
        this.input = (opts.input ?? process.stdin);
        this.output = opts.output ?? process.stdout;
        this.renderFrame = opts.render;
        this.validate = opts.validate;
        this.signal = opts.signal;
        this.value = opts.initialValue;
        this.trackValue = trackValue;
        this.userInput = opts.initialUserInput ?? "";
        this._cursor = this.userInput.length;
    }
    get cursor() {
        return this._cursor;
    }
    prompt() {return invoke("prompt",[this]);}
    promptNonTty() {return Promise.reject(new Error(nonTtyPromptMessage()));}
    readNonTtyLine() {return invoke("readLine",[this]);}
    setValue(value) {invoke("setValue",[this,value]);}
    setError(message) {this.error=message;}
    setUserInput(value) {invoke("setUserInput",[this,value]);}
    clearUserInput() {invoke("clearUserInput",[this]);}
    onCancel = () => {invoke("onCancel",[this]);};
    onKeypress = (char, key = {}) => {invoke("onKeypress",[this,char,key]);};
    updateTrackedInput(char, key, action) {invoke("updateTrackedInput",[this,char,key,action]);}
    render = () => {invoke("render",[this]);};
    close() {invoke("close",[this]);}
}
