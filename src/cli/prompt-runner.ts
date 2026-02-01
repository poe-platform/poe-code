import {
  cancel,
  isCancel,
  password,
  select,
  promptText as text
} from "@poe-code/design-system";
import { OperationCancelledError } from "./errors.js";
import type { PromptDescriptor } from "./prompts.js";
import type { PromptFn } from "./types.js";

export interface PromptAdapter {
  text: typeof text;
  password: typeof password;
  select: typeof select;
  isCancel: typeof isCancel;
  cancel: typeof cancel;
}

function toInitialValue(value: PromptDescriptor["initial"]): string | undefined {
  if (value == null) {
    return undefined;
  }
  return String(value);
}

function resolveSelectInitial(
  descriptor: PromptDescriptor
): string | undefined {
  if (descriptor.initial == null) {
    return undefined;
  }
  if (typeof descriptor.initial === "number") {
    return descriptor.choices?.[descriptor.initial]?.value;
  }
  return descriptor.initial;
}

export function createPromptRunner(
  adapter: PromptAdapter = {
    text,
    password,
    select,
    isCancel,
    cancel
  }
): PromptFn {
  const runPrompt = async (
    descriptor: PromptDescriptor
  ): Promise<string | number> => {
    const type = descriptor.type ?? "text";
    let result: string | symbol;

    if (type === "password") {
      result = await adapter.password({
        message: descriptor.message
      });
    } else if (type === "select") {
      const choices = descriptor.choices ?? [];
      if (choices.length === 0) {
        throw new Error(`Missing choices for "${descriptor.name}".`);
      }
      result = await adapter.select({
        message: descriptor.message,
        options: choices.map((choice) => ({
          label: choice.title,
          value: choice.value
        })),
        initialValue: resolveSelectInitial(descriptor)
      });
    } else {
      result = await adapter.text({
        message: descriptor.message,
        initialValue: toInitialValue(descriptor.initial)
      });
    }

    if (adapter.isCancel(result)) {
      adapter.cancel("Operation cancelled.");
      throw new OperationCancelledError();
    }

    return result as string;
  };

  return async (questions) => {
    const prompts = Array.isArray(questions)
      ? questions
      : questions
      ? [questions]
      : [];
    if (prompts.length === 0) {
      return {};
    }

    const responses: Record<string, unknown> = {};
    for (const prompt of prompts) {
      if (!prompt || typeof prompt !== "object") {
        throw new Error("Invalid prompt descriptor.");
      }
      const descriptor = prompt as PromptDescriptor;
      responses[descriptor.name] = await runPrompt(descriptor);
    }
    return responses;
  };
}
