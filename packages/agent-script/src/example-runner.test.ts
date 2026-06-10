import { describe, expect, it } from "vitest";

import { runExampleFile } from "./example-runner.js";

function createSink(): {
  output: () => string;
  write: (chunk: string) => void;
} {
  const chunks: string[] = [];

  return {
    output: () => chunks.join(""),
    write: (chunk) => {
      chunks.push(chunk);
    }
  };
}

async function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => Promise<T> | T
): Promise<T> {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value,
      writable: true
    });
  }

  try {
    return await callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor === undefined) {
        delete (Object.prototype as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
}

describe("runExampleFile", () => {
  it("prints own messages from thrown non-Error values", async () => {
    const stderr = createSink();

    const exitCode = await runExampleFile("/repo/example.md", {
      readFile: async () => {
        throw { message: "configured failure" };
      },
      stderr,
      stdout: createSink()
    });

    expect(exitCode).toBe(1);
    expect(stderr.output()).toBe("configured failure\n");
  });

  it("ignores inherited messages from thrown non-Error values", async () => {
    const stderr = createSink();

    await withObjectPrototypeProperties({ message: "polluted failure" }, async () => {
      const exitCode = await runExampleFile("/repo/example.md", {
        readFile: async () => {
          throw {};
        },
        stderr,
        stdout: createSink()
      });

      expect(exitCode).toBe(1);
      expect(stderr.output()).toBe("[object Object]\n");
    });
  });
});
