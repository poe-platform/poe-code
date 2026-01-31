import { describe, it, expect } from "vitest";
import { createPromptLibrary } from "./prompts.js";

describe("prompt library", () => {
  it("builds a model descriptor with a provider-defined label", () => {
    const library = createPromptLibrary();
    const descriptor = library.model({
      label: "Codex model",
      defaultValue: "b",
      choices: [
        { title: "Option A", value: "a" },
        { title: "Option B", value: "b" }
      ]
    });
    expect(descriptor.message).toBe("Codex model");
    expect(descriptor.initial).toBe(1);
  });

  it("builds a reasoning descriptor with a provider-defined label", () => {
    const library = createPromptLibrary();
    const descriptor = library.reasoningEffort({
      label: "Codex reasoning effort",
      defaultValue: "medium"
    });
    expect(descriptor.message).toBe("Codex reasoning effort");
    expect(descriptor.initial).toBe("medium");
  });
});
