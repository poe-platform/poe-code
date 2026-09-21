import { createRequire } from "node:module";
const native = createRequire(import.meta.url)("./poe-agent-rust.node");
export class PromptRegistry {
  #order = new native.NativePromptOrder();
  #transforms = [];
  addTransform(fn) {
    this.#order.add(this.#transforms.length);
    this.#transforms.push(fn);
  }
  async compile(userPrompt, baseSystemPrompt) {
    let context = {
      userPrompt,
      ...(baseSystemPrompt === undefined ? {} : { baseSystemPrompt, system: baseSystemPrompt })
    };
    for (let index = 0; ; index++) {
      const handle = this.#order.get(index);
      if (handle === null) break;
      const transform = this.#transforms[handle];
      context = { ...(await transform(context)), userPrompt };
    }
    return context;
  }
  copyFrom(registry) {
    const handles = registry.#order.snapshot(),
      transforms = registry.#transforms.slice();
    this.#order.append(handles, this.#transforms.length);
    this.#transforms.push(...transforms);
  }
}
