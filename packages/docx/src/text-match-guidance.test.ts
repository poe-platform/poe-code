import { expect, it } from "vitest";
import { Volume } from "memfs";
import { paragraph, textContext, textFixture } from "../tests/fixtures/text.js";
import { createDocxInspectionCommandEngine } from "./inspection-command.js";

it.each([false, true])("guides unmatched literal replacement without leaking text (json=%s)", async (json) => {
  const input = await textFixture(paragraph("Private coastal observations"));
  const fs = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "", "/err": "" });
  const args = ["text", "replace", "-", "--find", "PrivateAbsent", "--with", "PrivateReplacement", "--all", "--dry-run"];
  if (json) args.push("--json");
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: args.map((value) => new TextEncoder().encode(value)),
    cwd: "/",
    signal: textContext.signal,
    filesystem: { async readFile() { throw new Error("Unexpected filesystem read"); } },
    stdin: { async *[Symbol.asyncIterator]() { yield new Uint8Array(fs.readFileSync("/input") as Buffer); } },
    stdout: { async write(bytes) { fs.appendFileSync("/out", bytes); } },
    stderr: { async write(bytes) { fs.appendFileSync("/err", bytes); } }
  });
  expect(result.exitCode).toBe(1);
  expect(new Uint8Array(fs.readFileSync("/input") as Buffer)).toEqual(input);
  const output = String(fs.readFileSync("/out"));
  const human = String(fs.readFileSync("/err"));
  if (json) {
    const envelope = JSON.parse(output);
    expect(envelope).toMatchObject({ operation: "text.replace", ok: false, data: null, affected: 0, locations: [], errors: [{ code: "missing-selection" }] });
    expect(envelope.errors[0].message).toContain("docx help text replace");
  } else expect(output).toBe("");
  expect(human).toContain("--find");
  expect(human).toContain("--scope");
  expect(human).toContain("docx help text replace");
  expect(human).toContain("--allow-empty");
  expect(human + output).not.toContain("Private");
});
