import { expect, it } from "vitest";
import { BytePath, type ExactFileStat } from "../src/contracts/object.js";
import { ObjectAuthority } from "../src/fs/object-authority.js";

it.each([0, -1n, 9223372036854775808n])("rejects invalid exact link counts %s", async nlink => {
  const authority = new ObjectAuthority({ objects: { open: async () => ({
    identity: {}, type: "file", close: async () => {},
    stat: async () => ({ type: "file", size: 0n, nlink }) as ExactFileStat,
  }) } }, { maxHandles: 1 });
  try {
    const opened = await authority.open(new BytePath(Uint8Array.of(47, 255)));
    await expect(authority.stat(opened.handle)).rejects.toMatchObject({ code: "EINVAL" });
  } finally { await authority.dispose(); }
});

it("serializes one exact link-count observation without using it as identity", async () => {
  let observations = 0;
  const authority = new ObjectAuthority({ objects: { open: async () => ({
    identity: {}, type: "file", close: async () => {},
    stat: async () => ({ type: "file", size: 0n,
      get nlink() { return ++observations === 1 ? 9007199254740993n : 0; },
    }) as ExactFileStat,
  }) } }, { maxHandles: 1 });
  try {
    const opened = await authority.open(new BytePath(Uint8Array.of(47, 255)));
    expect(JSON.parse(JSON.stringify(await authority.stat(opened.handle)))).toEqual({
      type: "file", size: "0", nlink: "9007199254740993",
    });
    expect(observations).toBe(1);
    await expect(authority.read("9007199254740993", "0", 1)).rejects.toMatchObject({ code: "EBADF" });
  } finally { await authority.dispose(); }
});
