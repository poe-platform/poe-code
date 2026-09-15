import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { spawnSync } from "node:child_process";
import pins from "./schema-pins.json" with { type: "json" };

function schemaRoot(): string {
  const root = process.env.DOCX_SCHEMA_ROOT;
  if (!root || !isAbsolute(root))
    throw new Error("Set DOCX_SCHEMA_ROOT to the absolute pinned test schema directory.");
  return root;
}

export function verifySchemaProfile(): void {
  const tool = spawnSync("/usr/bin/xmllint", ["--version"], { encoding: "utf8" });
  if (tool.error) throw tool.error;
  if (tool.status !== 0 || !tool.stderr.includes(`using libxml version ${pins.libxml_version}\n`))
    throw new Error("The independent test validator does not match the pinned version.");
  const root = schemaRoot();
  for (const [file, expected] of Object.entries(pins.files)) {
    const actual = createHash("sha256")
      .update(readFileSync(join(root, file)))
      .digest("hex");
    if (actual !== expected) throw new Error(`Test schema pin mismatch: ${file}`);
  }
}

export function schemaCheck(
  bytes: Uint8Array,
  schema: string
): {
  status: "valid" | "invalid" | "schema-unavailable";
  diagnostics: string;
} {
  if (!Object.hasOwn(pins.files, schema))
    throw new Error("Expected an explicitly pinned test schema.");
  const result = spawnSync(
    "/usr/bin/xmllint",
    ["--nonet", "--noout", "--schema", join(schemaRoot(), schema), "-"],
    {
      input: bytes,
      encoding: "utf8",
      timeout: 10000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, XML_CATALOG_FILES: "" }
    }
  );
  if (result.error) throw result.error;
  if (result.status === 0) return { status: "valid", diagnostics: result.stderr };
  if (result.status === 5) return { status: "schema-unavailable", diagnostics: result.stderr };
  if (result.status === 1 || result.status === 3)
    return { status: "invalid", diagnostics: result.stderr };
  throw new Error(`Independent validator execution failed (${result.status}): ${result.stderr}`);
}
