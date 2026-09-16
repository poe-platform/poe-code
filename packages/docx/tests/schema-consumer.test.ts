import { beforeEach, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { schemaCheck, verifySchemaProfile } from "./schema-consumer.js";

const state = vi.hoisted(() => ({ run: vi.fn(), read: vi.fn() }));
vi.mock("node:child_process", () => ({ spawnSync: state.run }));
vi.mock("node:fs", () => ({ readFileSync: state.read }));
vi.mock("./schema-pins.json", () => ({
  default: {
    libxml_version: "20913",
    files: { "original.xsd": "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" }
  }
}));

let volume: Volume;
beforeEach(() => {
  vi.stubEnv("DOCX_SCHEMA_ROOT", "/schemas");
  volume = Volume.fromJSON({ "/schemas/original.xsd": "abc" });
  state.read.mockReset().mockImplementation((path: string) => volume.readFileSync(path));
  state.run
    .mockReset()
    .mockReturnValue({ status: 0, stderr: "xmllint: using libxml version 20913\n" });
});

it("requires exact schema bytes and the pinned validator version", () => {
  expect(() => verifySchemaProfile()).not.toThrow();
  volume.writeFileSync("/schemas/original.xsd", "abd");
  expect(() => verifySchemaProfile()).toThrow("pin mismatch");
  state.run.mockReturnValue({ status: 0, stderr: "xmllint: using libxml version 20914\n" });
  expect(() => verifySchemaProfile()).toThrow("pinned version");
});

it("fails missing prerequisites without a skip or implicit path", () => {
  vi.stubEnv("DOCX_SCHEMA_ROOT", "");
  expect(() => verifySchemaProfile()).toThrow("absolute pinned test schema directory");
  vi.stubEnv("DOCX_SCHEMA_ROOT", "relative");
  expect(() => verifySchemaProfile()).toThrow("absolute pinned test schema directory");
  state.run.mockReturnValue({ error: new Error("Tool unavailable") });
  expect(() => verifySchemaProfile()).toThrow("Tool unavailable");
});

it.each([
  [0, "valid"],
  [1, "invalid"],
  [3, "invalid"],
  [5, "schema-unavailable"]
] as const)(
  "classifies tool status %s as %s without laundering unavailable schemas",
  (status, expected) => {
    state.run.mockReturnValue({ status, stderr: "Original diagnostic" });
    const bytes = new TextEncoder().encode("Original input");
    expect(schemaCheck(bytes, "original.xsd")).toEqual({
      status: expected,
      diagnostics: "Original diagnostic"
    });
    expect(state.run.mock.calls[0]![1]).toEqual([
      "--nonet",
      "--noout",
      "--schema",
      "/schemas/original.xsd",
      "-"
    ]);
    expect(state.run.mock.calls[0]![2]).toMatchObject({
      input: bytes,
      env: { XML_CATALOG_FILES: "" }
    });
    expect(volume.readFileSync("/schemas/original.xsd", "utf8")).toBe("abc");
  }
);

it("rejects unpinned paths and execution failures", () => {
  expect(() => schemaCheck(new Uint8Array(), "../other.xsd")).toThrow("explicitly pinned");
  expect(state.run).not.toHaveBeenCalled();
  state.run.mockReturnValue({ status: 2, stderr: "Execution failed" });
  expect(() => schemaCheck(new Uint8Array(), "original.xsd")).toThrow("execution failed");
  state.run.mockReturnValue({ error: new Error("Execution timed out") });
  expect(() => schemaCheck(new Uint8Array(), "original.xsd")).toThrow("Execution timed out");
});
