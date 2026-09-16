import { expect, it } from "vitest";
import { createDocxCommandEngine, validateDocxInvocation } from "./command.js";

it("guides an unselected image edit before dispatch or source consumption", async () => {
  let touched = false;
  const output: Uint8Array[] = [];
  const diagnostics: Uint8Array[] = [];
  const result = await createDocxCommandEngine({
    async execute() {
      touched = true;
      return { exitCode: 0 };
    }
  }).execute({
    args: ["images", "replace", "private.docx", "--file", "private.png", "--dry-run", "--json"].map(
      (word) => new TextEncoder().encode(word)
    ),
    signal: new AbortController().signal,
    stdin: {
      async *[Symbol.asyncIterator]() {
        touched = true;
        yield new Uint8Array();
      }
    },
    stdout: {
      async write(bytes) {
        output.push(bytes);
      }
    },
    stderr: {
      async write(bytes) {
        diagnostics.push(bytes);
      }
    }
  });
  const envelope = JSON.parse(output.map((bytes) => new TextDecoder().decode(bytes)).join(""));
  const human = diagnostics.map((bytes) => new TextDecoder().decode(bytes)).join("");
  expect(result.exitCode).toBe(2);
  expect(touched).toBe(false);
  expect(envelope).toMatchObject({
    operation: "images.replace",
    ok: false,
    data: null,
    affected: 0,
    errors: [{ code: "usage" }]
  });
  expect(envelope.errors[0].message).toContain("--select");
  expect(envelope.errors[0].message).toContain("docx help images replace");
  expect(human).toContain("docx help images replace");
  expect(human).not.toContain("private");
});

it("gives SDK callers the same declared selection discovery route", () => {
  expect(() =>
    validateDocxInvocation({
      operation: "images.replace",
      inputs: ["private.docx"],
      options: { file: { kind: "vfs", path: "private.png", capability: "test" }, dryRun: true }
    })
  ).toThrow("docx help images replace");
});
