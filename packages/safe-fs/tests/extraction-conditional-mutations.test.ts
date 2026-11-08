import { expect, it } from "vitest";
import { createMemoryFileSystem } from "../src/core.js";

for (const operation of ["write", "remove"] as const) {
  it(`confined conditional ${operation} retains ancestry and entry revision`, async () => {
    const fs = createMemoryFileSystem();
    await fs.mkdir("/work/sub", { recursive: true });
    await fs.mkdir("/private");
    for (const path of ["/work/sub/target", "/private/target"]) await fs.writeFile(path, Buffer.from("old"));
    const parent = await fs.lstat("/work/sub");
    const expected = await fs.lstat("/work/sub/target");
    const confined = await fs.confineExtraction!(["/work/sub"]);
    const mutate = async () => operation === "write"
      ? confined.writeFileConditional!("/work/sub/target", Buffer.from("new"), { parent, expected })
      : confined.removeFileConditional!("/work/sub/target", { parent, expected });
    await fs.writeFile("/work/sub/target", Buffer.from("old"));
    await expect(mutate()).rejects.toMatchObject({ code: "EAGAIN" });
    await fs.rename("/work/sub", "/work/retired");
    await fs.symlink("/private", "/work/sub");
    await expect(mutate()).rejects.toMatchObject({ code: "EAGAIN" });
    expect(Buffer.from(await fs.readFile("/private/target")).toString()).toBe("old");
    expect(Buffer.from(await fs.readFile("/work/retired/target")).toString()).toBe("old");
  });
}

it("confined conditional mutations create, update and remove their owned file", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  const parent = await fs.lstat("/work");
  const confined = await fs.confineExtraction!(["/work"]);
  const created = await confined.writeFileConditional!("/work/new", Buffer.from("old"), { parent, expected: null });
  const updated = await confined.writeFileConditional!("/work/new", Buffer.from("new"), { parent, expected: created });
  await expect(confined.removeFileConditional!("/work/new", { parent, expected: created })).rejects.toMatchObject({ code: "EAGAIN" });
  await confined.removeFileConditional!("/work/new", { parent, expected: updated });
  await expect(fs.lstat("/work/new")).rejects.toMatchObject({ code: "ENOENT" });
});
