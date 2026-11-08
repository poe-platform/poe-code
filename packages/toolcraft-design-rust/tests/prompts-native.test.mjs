import assert from "node:assert/strict";
import {test} from "node:test";
import * as original from "../../toolcraft-design/dist/prompts/index.js";
import {withOutputFormat as originalFormat} from "../../toolcraft-design/dist/internal/output-format.js";
import {Prompt as OriginalPrompt} from "../../toolcraft-design/dist/prompts/interactive/core.js";

test("public prompts preserve namespace shape, async factories and shared export identities", async () => {
  const root = await import("toolcraft-design-rust"), prompts = await import("toolcraft-design-rust/prompts/index");
  assert.equal(root.prompts, prompts);
  assert.deepEqual(Object.keys(prompts), Object.keys(original));
  assert.equal(Object.getPrototypeOf(prompts), null); assert.equal(Object.isExtensible(prompts), false);
  const direct = {select: "select", multiselect: "multiselect", text: "prompt-text", confirm: "confirm", confirmOrCancel: "confirm-or-cancel", password: "password"};
  for (const name of Object.keys(original)) {
    assert.equal(root[name === "text" ? "promptText" : name], prompts[name]);
    if (typeof original[name] === "function") {assert.equal(prompts[name].name, original[name].name); assert.equal(prompts[name].length, original[name].length);assert.equal(prompts[name].constructor.name, original[name].constructor.name);}
    if (direct[name]) {const module = await import(`toolcraft-design-rust/${direct[name]}`);const reference = await import(`../../toolcraft-design/dist/${direct[name]}.js`);assert.deepEqual(Object.keys(module), Object.keys(reference));assert.equal(module[name === "text" ? "promptText" : name], prompts[name]);}
  }
});

test("public prompt wrappers preserve thenable adoption and async arbitrary failures", async () => {
  const prompts = await import("toolcraft-design-rust/prompts/index");
  const {Prompt} = await import("toolcraft-design-rust/prompts/interactive/core");
  async function observe(api, Base, name) {
    const trace = [], saved = Base.prototype.prompt, value = {}, failure = {};
    const result = {get then() {trace.push("then");return function(resolve) {trace.push(this === result);resolve(value);};}};
    Base.prototype.prompt = function() {trace.push(this.constructor.name);return result;};
    let pending;
    try {pending = api[name]({message: "Value", options: [{value: "one", label: "One"}]});assert.ok(pending instanceof Promise);assert.notEqual(pending, result);trace.push("returned");assert.equal(await pending, value);}
    finally {Base.prototype.prompt = saved;}
    const bad = new Proxy({}, {ownKeys() {throw failure;}, get() {throw failure;}});
    assert.doesNotThrow(() => {pending = api[name](bad);});await assert.rejects(pending, error => error === failure);
    return trace;
  }
  for (const name of ["select", "multiselect", "text", "confirm", "password"]) assert.deepEqual(await observe(prompts, Prompt, name), await observe(original, OriginalPrompt, name));
});

test("confirmOrCancel preserves cancellation output, strict boolean results and writer failures", async () => {
  const api = await import("toolcraft-design-rust/prompts/index"), {withOutputFormat} = await import("toolcraft-design-rust");
  const previous = process.env.POE_NO_PROMPT; process.env.POE_NO_PROMPT = "1";
  try {
    for (const value of [true, false, 1, "yes", {}, null, undefined]) assert.equal(await api.confirmOrCancel({message: "Continue?", initialValue: value, input: {isTTY: false}}), await original.confirmOrCancel({message: "Continue?", initialValue: value, input: {isTTY: false}}));
    async function observe(prompts, formatFn, format, fail) {
      const output = [], failure = {}, saved = process.stdout.write, controller = new AbortController();controller.abort();
      process.stdout.write = function(value) {if (fail) throw failure;output.push([this === process.stdout, value]);return true;};
      try {await formatFn(format, () => prompts.confirmOrCancel({message: "Continue?", signal: controller.signal}));assert.fail("Expected cancellation");}
      catch (error) {if (fail) {assert.equal(error, failure);return output;}assert.ok(error instanceof prompts.PromptCancelledError);return {name: error.name, message: error.message, output};}
      finally {process.stdout.write = saved;}
    }
    for (const format of ["terminal", "markdown", "json"]) for (const fail of format === "terminal" ? [false, true] : [false]) assert.deepEqual(await observe(api, withOutputFormat, format, fail), await observe(original, originalFormat, format, fail));
  } finally {if (previous === undefined) delete process.env.POE_NO_PROMPT;else process.env.POE_NO_PROMPT = previous;}
});

test("PromptCancelledError preserves descriptors, message coercion and stack hooks", async () => {
  const {PromptCancelledError} = await import("toolcraft-design-rust/prompts/index");
  function observe(Base, message, enabled) {
    const trace = [], saved = Object.getOwnPropertyDescriptor(Error, "captureStackTrace");
    Object.defineProperty(Error, "captureStackTrace", {configurable: true, value: enabled ? function(error, constructor) {trace.push([this === Error, constructor === error.constructor, constructor.name]);} : undefined});
    try {class Child extends Base {} const error = new Child(message);const descriptors = Object.getOwnPropertyDescriptors(error);delete descriptors.stack;return {trace, descriptors, error: error instanceof Error, base: error instanceof Base};}
    finally {if (saved) Object.defineProperty(Error, "captureStackTrace", saved);else delete Error.captureStackTrace;}
  }
  for (const enabled of [false, true]) for (const message of [undefined, "Custom", "", null, 0, {toString: () => "Coerced"}]) assert.deepEqual(observe(PromptCancelledError, message, enabled), observe(original.PromptCancelledError, message, enabled));
});
