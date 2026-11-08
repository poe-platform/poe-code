import { expect, it, vi } from "vitest";
import { Document, Image, InputTypeError, resolveDocumentModelContext } from "./index.js";
import { paragraph, textContext, textFixture } from "../tests/fixtures/text.js";
import { rasterPng } from "../tests/fixtures/raster.js";

it("retains own nonenumerable transport metadata and lowered limits", async () => {
  const limits = Object.defineProperty({}, "tableRows", { value: 2 });
  const input = Object.defineProperties(
    {},
    {
      author: { value: "Captured" },
      timestamp: { value: "2026-09-16T01:02:03Z" },
      limits: { value: limits }
    }
  );
  const context = await resolveDocumentModelContext(input, textContext);
  expect(context.author).toBe("Captured");
  expect(context.timestamp!.toISOString()).toBe("2026-09-16T01:02:03.000Z");
  expect(context.budget.limits.tableRows).toBe(2);
});

it("selects own nonenumerable VFS and font tokens without ambient adapters", async () => {
  const open = vi.fn(async function* () {
    yield rasterPng();
  });
  const measure = vi.fn(() => 0);
  const value = Object.defineProperties(
    {},
    { vfs: { value: "owned" }, fonts: { value: "metrics" } }
  );
  const context = await resolveDocumentModelContext(value, {
    ...textContext,
    binaryResolver: { capability: "owned", open },
    fontResolver: { capability: "metrics", fonts: { measure } }
  });
  expect(context.vfs).toBeDefined();
  expect(context.fonts!.measure("", "Explicit", 0.5)).toBe(0);
  expect(
    (await Image.from_file({ path: "/image.png", capability: context.vfs! }, context)).px_width
  ).toBe(1);
  await expect(resolveDocumentModelContext(value)).rejects.toMatchObject({ code: "usage" });
});

it.each(["author", "timestamp", "limits", "vfs", "fonts", "template"])(
  "rejects a nonenumerable %s accessor without invoking it",
  async (key) => {
    const getter = vi.fn();
    await expect(
      resolveDocumentModelContext(Object.defineProperty({}, key, { get: getter }))
    ).rejects.toBeInstanceOf(InputTypeError);
    expect(getter).not.toHaveBeenCalled();
  }
);

it.each(["unknown", "work"])("rejects malformed nonenumerable nested limit %s", async (key) => {
  await expect(
    resolveDocumentModelContext({ limits: Object.defineProperty({}, key, { value: -1 }) })
  ).rejects.toMatchObject({ code: "usage" });
});

it("retains a nested nonenumerable transport limit", async () => {
  const context = await resolveDocumentModelContext(
    {
      limits: Object.defineProperty({}, "tableRows", { value: 2 })
    },
    textContext
  );
  expect(context.budget.limits.tableRows).toBe(2);
});

it("retains an own nonenumerable template instead of creating an empty document", async () => {
  const bytes = await textFixture(paragraph("Required template"));
  const context = await resolveDocumentModelContext(
    Object.defineProperty({}, "template", {
      value: { kind: "bytes", base64: Buffer.from(bytes).toString("base64") }
    }),
    textContext
  );
  expect((await Document(null, context)).paragraphs[0]?.text).toBe("Required template");
});

it("retains own nonenumerable fields in a template descriptor", async () => {
  const bytes = await textFixture(paragraph("Nested template"));
  const template = Object.defineProperties(
    {},
    {
      kind: { value: "bytes" },
      base64: { value: Buffer.from(bytes).toString("base64") }
    }
  );
  const context = await resolveDocumentModelContext({ template: template as never }, textContext);
  expect((await Document(null, context)).paragraphs[0]?.text).toBe("Nested template");
});
