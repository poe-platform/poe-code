import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createResourceIO } from "./index.js";

it("retains the admitted VFS namespace when the host mutates its configuration", async () => {
  const volume = Volume.fromJSON({ "/admitted/input": "original", "/foreign/input": "foreign" });
  const events: string[] = [];
  const options = {
    cwd: "/admitted",
    filesystem: {
      async read(path: string) { events.push(path); return [new Uint8Array(volume.readFileSync(path) as Uint8Array)]; },
      async write(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); }
    }
  };
  const io = createResourceIO(options);
  options.cwd = "/foreign";
  options.filesystem = {
    async read() { throw new Error("foreign capability invoked"); },
    async write() { throw new Error("foreign capability invoked"); }
  };
  const signal = new AbortController().signal;
  const bytes: number[] = [];
  for await (const chunk of await io.read("input", signal)) bytes.push(...chunk);
  expect(new TextDecoder().decode(new Uint8Array(bytes))).toBe("original");
  await io.write("output", new Uint8Array([0, 255]), signal);
  expect(events).toEqual(["/admitted/input"]);
  expect(volume.readFileSync("/admitted/output")).toEqual(Buffer.from([0, 255]));
  expect(volume.existsSync("/foreign/output")).toBe(false);
});
