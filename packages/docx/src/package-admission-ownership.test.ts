import { expect, it } from "vitest";
import { Document, PackageView, InputTypeError } from "./index.js";
import { textContext } from "../tests/fixtures/text.js";
import { textFixture } from "../tests/fixtures/text.js";

it.each([PackageView])(
  "captures package bytes and metadata before its first suspension",
  async (factory) => {
    const bytes = await textFixture("<w:p><w:r><w:t>Original</w:t></w:r></w:p>");
    const timestamp = new Date("2025-01-02T03:04:05Z");
    const context = { ...textContext, timestamp, author: "Original author" };
    const pending = factory.open(bytes, context);
    expect(pending).toBeInstanceOf(Promise);
    bytes.fill(0);
    context.author = "Later author";
    timestamp.setUTCFullYear(2030);
    const owner = await pending;
    const document = owner.main_document_part.document;
    expect(document.paragraphs[0]!.text).toBe("Original");
    const comment = document.add_comment(document.paragraphs[0]!.runs[0]!);
    expect(comment.timestamp?.toISOString()).toBe("2025-01-02T03:04:05.000Z");
    expect(comment.author).toBe("");
  }
);

it.each([PackageView])(
  "captures an explicit package path before awaiting admission",
  async (factory) => {
    const bytes = await textFixture("<w:p><w:r><w:t>Path content</w:t></w:r></w:p>");
    const paths: string[] = [];
    const input = { path: "/original", capability: "memory" };
    const pending = factory.open(input, {
      ...textContext,
      binaryResolver: {
        capability: "memory",
        async *open(path) {
          paths.push(path);
          yield bytes;
        }
      }
    });
    input.path = "/later";
    expect((await pending).main_document_part.document.paragraphs[0]!.text).toBe("Path content");
    expect(paths).toEqual(["/original"]);
  }
);

it.each([Document, PackageView.open])(
  "rejects malformed admission through a Promise",
  async (factory) => {
    const pending = factory("/ambient/path" as never);
    expect(pending).toBeInstanceOf(Promise);
    await expect(pending).rejects.toBeInstanceOf(InputTypeError);
  }
);
