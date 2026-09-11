import assert from "node:assert/strict";
import { test } from "node:test";
import type { Dirent } from "node:fs";
import { Volume, createFsFromVolume } from "memfs";
import { census, digest } from "../shell-stress/invocation-cleanup-runtime/migration/binding.js";

function fixture() {
  const fs = createFsFromVolume(Volume.fromJSON({
    "/snapshot/z.txt": "last", "/snapshot/nested/a.txt": "first",
  }));
  fs.writeFileSync("/snapshot/nested/b.bin", Buffer.from([0, 255, 128]));
  const io = {
    readdir: async (path: string) => fs.readdirSync(path, { withFileTypes: true }) as Dirent[],
    readFile: async (path: string) => fs.readFileSync(path) as Buffer,
  };
  return { fs, io };
}

test("public snapshot census preserves complete sorted binary hashes and detects every inventory change", async () => {
  const { fs, io } = fixture();
  const original = await census("/snapshot", "/snapshot", io);
  assert.deepEqual(original, {
    "nested/a.txt": digest("first"), "nested/b.bin": digest(Buffer.from([0, 255, 128])), "z.txt": digest("last"),
  });
  assert.deepEqual(Object.keys(original), ["nested/a.txt", "nested/b.bin", "z.txt"]);
  fs.writeFileSync("/snapshot/z.txt", "changed");
  assert.notDeepEqual(await census("/snapshot", "/snapshot", io), original);
  fs.writeFileSync("/snapshot/z.txt", "last");
  fs.writeFileSync("/snapshot/added.txt", "extra");
  assert.notDeepEqual(await census("/snapshot", "/snapshot", io), original);
  fs.unlinkSync("/snapshot/added.txt");
  fs.unlinkSync("/snapshot/nested/a.txt");
  assert.notDeepEqual(await census("/snapshot", "/snapshot", io), original);
});

test("public snapshot census refuses file and directory symlinks", async () => {
  for (const target of ["/snapshot/z.txt", "/snapshot/nested"]) {
    const { fs, io } = fixture();
    fs.symlinkSync(target, "/snapshot/alias");
    await assert.rejects(census("/snapshot", "/snapshot", io), /Unexpected snapshot symlink/);
  }
});

test("public snapshot census overlaps reads within a fixed bound", async () => {
  const { fs, io } = fixture();
  for (let index = 0; index < 40; index++) fs.writeFileSync(`/snapshot/file-${index}`, "value");
  let active = 0, peak = 0, completed = 0;
  const result = await census("/snapshot", "/snapshot", {
    ...io,
    readFile: async path => {
      active++; peak = Math.max(peak, active);
      try {
        await new Promise<void>(resolve => setImmediate(resolve));
        return await io.readFile(path);
      } finally { active--; completed++; }
    },
  });
  assert.ok(peak > 1, "Independent file reads must overlap");
  assert.ok(peak <= 16, "Census must bound open reads");
  assert.equal(active, 0);
  assert.equal(completed, 43);
  assert.equal(Object.keys(result).length, 43);
});

test("public snapshot census drains admitted reads before reporting exact failure", async () => {
  const { fs, io } = fixture();
  for (let index = 0; index < 40; index++) fs.writeFileSync(`/snapshot/z-${index}`, "value");
  const reason = new Error("injected read failure");
  let active = 0, completed = 0, started = 0;
  await assert.rejects(census("/snapshot", "/snapshot", {
    ...io,
    readFile: async path => {
      active++; started++;
      try {
        if (path.endsWith("a.txt")) throw reason;
        await new Promise<void>(resolve => setImmediate(resolve));
        return await io.readFile(path);
      } finally { active--; completed++; }
    },
  }), error => error === reason);
  assert.equal(started, 16, "Failure must drain the admitted batch without starting another");
  assert.equal(active, 0);
  assert.equal(completed, started);
});
