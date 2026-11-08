import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readComments, readCommentAuthors } from "./comments.js";
import { deck, context } from "../tests/fixtures/modern-comments.js";
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((cb: () => void, delay?: number) =>
    delay === 0 ? setImmediate(cb) : timer(cb, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
describe("modern comment inventory", () => {
  it("reads thread identity, rich text, person identity and reply associations without guessing missing authors", async () => {
    const rows = await readComments(await deck(), {}, context);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      format: "modern",
      id: "{20000000-0000-0000-0000-000000000001}",
      index: null,
      text: "Review & refine\vNext\nLast",
      left: 12700,
      top: -50,
      status: "active",
      threadId: "{20000000-0000-0000-0000-000000000001}",
      parentId: null,
      authorIdentity: {
        name: "Rowan",
        userId: "rowan@example.test",
        providerId: "directory",
        initials: null
      },
      replies: [
        {
          id: "{30000000-0000-0000-0000-000000000001}",
          text: "Answer",
          parentId: "{20000000-0000-0000-0000-000000000001}",
          threadId: "{20000000-0000-0000-0000-000000000001}",
          authorIdentity: null
        }
      ]
    });
  });
  it("inventories reaction instances and opaque mention markup under the owning thread", async () => {
    const row = (await readComments(await deck(), {}, context))[0]!;
    expect(row).toMatchObject({
      reactions: [
        {
          type: "👍",
          instances: [
            {
              authorId: "{40000000-0000-0000-0000-000000000001}",
              timestamp: "2031-01-02T05:00:00Z"
            }
          ]
        }
      ]
    });
    expect("opaqueXml" in row && row.opaqueXml).toContain('person="external-person"');
  });
  it("resolves modern thread and reply selectors with stale fingerprints rejected", async () => {
    const bytes = await deck();
    const row = (await readComments(bytes, {}, context))[0]!;
    if (!("replies" in row)) throw new Error("Modern thread required");
    const reply = row.replies[0]!;
    expect(await readComments(bytes, { selection: { token: reply.selector } }, context)).toEqual([
      reply
    ]);
    expect(await readComments(bytes, { id: reply.id }, context)).toEqual([reply]);
    await expect(
      readComments(
        bytes,
        { selection: { token: JSON.stringify({ ...row.location, fingerprint: "0".repeat(64) }) } },
        context
      )
    ).rejects.toMatchObject({ code: "stale-selection" });

    expect(await readComments(bytes, { selection: { token: row.selector } }, context)).toEqual([
      row
    ]);
  });
  it("inventories author-only decks without creating phantom threads", async () => {
    const bytes = await deck(true);
    expect(await readComments(bytes, {}, context)).toEqual([]);
    expect(await readCommentAuthors(bytes, context)).toMatchObject([
      {
        id: "{10000000-0000-0000-0000-000000000001}",
        name: "Rowan",
        userId: "rowan@example.test",
        providerId: "directory"
      }
    ]);
  });
});
