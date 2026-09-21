import { expect, it } from "vitest";
import { createZipCodec } from "@poe-code/office-package";
import type { CapabilityContext } from "../contracts.js";
import { createOdfWriter, readOdf } from "./odf.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 3, operations: 1000 } };
const limits = { maxArchiveBytes: 100000, maxEntryBytes: 100000, maxTotalBytes: 100000,
  maxMembers: 100, maxPathBytes: 1024, maxDepth: 32, maxPaxBytes: 10000, maxTextBytes: 100000, chunkSize: 4096 };

// Measured with released 1.12.61: integer dates omit time; fractional dates
// retain it even when rounded to zero, and carry midnight into the date.
it.each(["strict", "extended"] as const)("matches native date rounding at midnight in %s", async profile => {
  const values = [45292, 45292 + 0.1 / 86400, 45292 + 86399.8 / 86400, 45292 + 86399.4 / 86400];
  const bytes = await createOdfWriter(profile)({ sheets: [{ id: "s", name: "S", cells: values.map((value, row) => ({
    row, column: 0, format: "yyyy-mm-dd hh:mm:ss", value: { kind: "number" as const, value }
  })) }] }, [], context);
  const zip = createZipCodec(), archive = await zip.readZipArchive(bytes, limits, context.signal);
  const chunks: Uint8Array[] = [];
  for await (const chunk of zip.decodeZipEntry(archive.entries.find(entry => entry.name === "content.xml")!, limits, context.signal)) chunks.push(chunk);
  const xml = Buffer.concat(chunks).toString("utf8");
  for (const date of ["2024-01-01", "2024-01-01T00:00:00", "2024-01-02T00:00:00", "2024-01-01T23:59:59"])
    expect(xml).toContain(`office:date-value="${date}"`);
  expect(xml).not.toContain("T24:");
  const reopened = await readOdf(bytes, context);
  expect(reopened.sheets[0]!.cells.map(cell => cell.value)).toEqual([45292, 45292, 45293, 45292 + 86399 / 86400].map(value => ({ kind: "number", value })));
});
