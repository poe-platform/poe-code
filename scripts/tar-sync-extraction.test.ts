import { expect, it } from "vitest";
import { Volume } from "memfs";
import { evalSyncTar } from "../packages/safe-bash/src/commands/archive/index.js";
import { headerBytes } from "../packages/safe-bash/src/commands/archive/format.js";

it("publishes selected tar files and directories through the synchronous callbacks", () => {
  const archive = new Uint8Array(2560);
  const entry = { linkname: "", uid: 0, gid: 0, mtime: 0 };
  archive.set(headerBytes({ ...entry, name: "tree/", type: "5", size: 0, mode: 0o755 }));
  archive.set(headerBytes({ ...entry, name: "tree/value.txt", type: "0", size: 5, mode: 0o640 }), 512);
  archive.set(new TextEncoder().encode("hello"), 1024);
  const volume = Volume.fromJSON({});
  const result = evalSyncTar(archive, ["-xvf", "-", "-C", "/out"], undefined,
    (path, bytes, mode) => { volume.writeFileSync(path, bytes, { mode }); return true; },
    (path, mode) => { volume.mkdirSync(path, { recursive: true, mode }); return true; });
  expect(result).toBe("tree/\ntree/value.txt\n");
  expect(volume.toJSON()).toEqual({ "/out/tree/value.txt": "hello" });
  expect(Number(volume.statSync("/out/tree/value.txt").mode) & 0o777).toBe(0o640);
});
