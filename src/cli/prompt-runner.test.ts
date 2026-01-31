import { describe, it, expect, vi } from "vitest";
import { createPromptRunner } from "./prompt-runner.js";
import { OperationCancelledError } from "./errors.js";

const createAdapter = () => ({
  text: vi.fn(),
  password: vi.fn(),
  select: vi.fn(),
  isCancel: vi.fn(),
  cancel: vi.fn()
});

describe("createPromptRunner", () => {
  it("uses the adapter for text prompts", async () => {
    const adapter = createAdapter();
    adapter.text.mockResolvedValue("hello");
    adapter.isCancel.mockReturnValue(false);
    const runner = createPromptRunner(adapter);

    const result = await runner({
      name: "value",
      message: "Say hello",
      type: "text",
      initial: "hi"
    });

    expect(adapter.text).toHaveBeenCalledWith({
      message: "Say hello",
      initialValue: "hi"
    });
    expect(result).toEqual({ value: "hello" });
  });

  it("uses the adapter for password prompts", async () => {
    const adapter = createAdapter();
    adapter.password.mockResolvedValue("secret");
    adapter.isCancel.mockReturnValue(false);
    const runner = createPromptRunner(adapter);

    const result = await runner({
      name: "apiKey",
      message: "Enter key",
      type: "password"
    });

    expect(adapter.password).toHaveBeenCalledWith({
      message: "Enter key"
    });
    expect(result).toEqual({ apiKey: "secret" });
  });

  it("maps select prompts with choices and initial selection", async () => {
    const adapter = createAdapter();
    adapter.select.mockResolvedValue("b");
    adapter.isCancel.mockReturnValue(false);
    const runner = createPromptRunner(adapter);

    const result = await runner({
      name: "model",
      message: "Pick model",
      type: "select",
      initial: 1,
      choices: [
        { title: "Option A", value: "a" },
        { title: "Option B", value: "b" }
      ]
    });

    expect(adapter.select).toHaveBeenCalledWith({
      message: "Pick model",
      options: [
        { label: "Option A", value: "a" },
        { label: "Option B", value: "b" }
      ],
      initialValue: "b"
    });
    expect(result).toEqual({ model: "b" });
  });

  it("throws a user-facing error on cancellation", async () => {
    const adapter = createAdapter();
    const cancelToken = Symbol("cancel");
    adapter.text.mockResolvedValue(cancelToken);
    adapter.isCancel.mockReturnValue(true);
    const runner = createPromptRunner(adapter);

    await expect(
      runner({
        name: "value",
        message: "Say hello",
        type: "text"
      })
    ).rejects.toBeInstanceOf(OperationCancelledError);

    expect(adapter.cancel).toHaveBeenCalledWith("Operation cancelled.");
  });
});
