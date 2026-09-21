import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Document, createDocxInspectionCommandEngine, openDocumentLocations, readArchive } from "./index.js";
import { paragraph, run, textContext, textFixture, w } from "../tests/fixtures/text.js";

const timestamp = "2025-04-05T06:07:08Z";
const cases = [
  { ids: [], next: 0 },
  { ids: [1], next: 2 },
  { ids: [4, 2147483646], next: 2147483647 },
  { ids: [1, 2147483647], next: 0 },
  { ids: [1, 2, 3], next: 4 },
  { ids: [0, 1, 3, 2147483647], next: 2 }
];

it.each(cases)("allocates a bounded comment ID after $ids as $next", async ({ ids, next }) => {
  const input = await textFixture(paragraph("海岸 🌊") + ids.map(id => `<w:p><w:commentRangeStart w:id="${id}"/>${run("Old")}<w:commentRangeEnd w:id="${id}"/><w:r><w:commentReference w:id="${id}"/></w:r></w:p>`).join(""), {
    comments: {
      kind: "comments",
      xml: `<w:comments xmlns:w="${w}">${ids.map(id => `<w:comment w:id="${id}" w:author="Reader">${paragraph("Retained note")}</w:comment>`).join("")}</w:comments>`
    }
  });
  const volume = Volume.fromJSON({ "/input": Buffer.from(input), "/model": "", "/utility": "", "/err": "" });
  const document = await Document(new Uint8Array(volume.readFileSync("/input") as Buffer), {
    ...textContext, timestamp: new Date(timestamp)
  });
  const added = document.comments.add_comment("確認 🌊", "Mira", null);
  expect(added.comment_id).toBe(next);
  expect([...document.comments].map(comment => comment.comment_id)).toEqual([...ids, next]);
  expect(document.comments.get(next)?.equals(added)).toBe(true);
  expect(document.comments.get(next + 10)).toBeNull();
  expect(added.timestamp?.toISOString()).toBe(new Date(timestamp).toISOString());
  expect(added.initials).toBeNull();
  await document.save({ async write(bytes) { volume.appendFileSync("/model", bytes); } });
  const reopened = await Document(new Uint8Array(volume.readFileSync("/model") as Buffer), textContext);
  expect(reopened.comments.get(next)?.text).toBe("確認 🌊");
  const locations = await openDocumentLocations(input, textContext);
  const selection = locations.range(locations.at("paragraph", 1).token, 0, 4).token;
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: ["comments", "add", "/input", "--select", selection, "--text", "確認 🌊", "--author", "Mira", "--timestamp", timestamp, "--output", "-"].map(value => new TextEncoder().encode(value)),
    cwd: "/", signal: textContext.signal,
    filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } },
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(bytes) { volume.appendFileSync("/utility", bytes); } },
    stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } }
  });
  expect(result.exitCode, volume.readFileSync("/err", "utf8") as string).toBe(0);
  const archive = await readArchive(new Uint8Array(volume.readFileSync("/utility") as Buffer), textContext);
  const xml = new TextDecoder().decode(archive.members.find(member => member.name === "word/comments.xml")!.bytes);
  expect(xml).toBe(`<w:comments xmlns:w="${w}">${ids.map(id => `<w:comment w:id="${id}" w:author="Reader">${paragraph("Retained note")}</w:comment>`).join("")}<cm:comment xmlns:cm="${w}" cm:id="${next}" cm:author="Mira" cm:date="${timestamp}" cm:initials=""><cm:p><pi:r xmlns:pi="${w}"><pi:t xml:space="preserve">確認 🌊</pi:t></pi:r></cm:p></cm:comment></w:comments>`);
  const body = new TextDecoder().decode(archive.members.find(member => member.name === "word/document.xml")!.bytes);
  for (const marker of ["commentRangeStart", "commentRangeEnd", "commentReference"]) {
    expect(body).toContain(`<cm:${marker}${marker === "commentReference" ? "" : ` xmlns:cm="${w}"`} cm:id="${next}"/>`);
  }
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});
