import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createSipsCommand, runSipsCli } from "./index.js";

it("preserves set and deleted properties through copied VFS bytes and output copies", async () => {
  const files = new Map([["in.png", await sharp({ create: { width: 2, height: 1, channels: 4, background: "red" } }).png().toBuffer()]]);
  expect((await runSipsCli(["-s", "description", "Hello World", "-s", "dpiWidth", "144", "-s", "dpiHeight", "72", "in.png", "-o", "out.png"], files)).exitCode).toBe(0);
  files.set("copy.png", files.get("out.png")!.slice());
  const query = await runSipsCli(["-g", "description", "-g", "dpiWidth", "-g", "dpiHeight", "copy.png"], files);
  expect(query.stdout).toContain("description: Hello World");
  expect(query.stdout).toContain("dpiWidth: 144.000");
  expect(query.stdout).toContain("dpiHeight: 72.000");
  expect((await runSipsCli(["-d", "dpiWidth", "copy.png"], files)).exitCode).toBe(0);
  files.set("copy.png", files.get("copy.png")!.slice());
  expect((await runSipsCli(["-g", "dpiWidth", "copy.png"], files)).stdout).toContain("dpiWidth: <nil>");
});

it("escapes paths and property values in allxml", async () => {
  const path = "a&<b>\"'.png";
  const files = new Map([[path, await sharp({ create: { width: 1, height: 1, channels: 4, background: "blue" } }).png().toBuffer()]]);
  await runSipsCli(["-s", "space", "A&<B>\"'", path], files);
  const result = await runSipsCli(["-g", "allxml", path], files);
  expect(result.stdout).toContain("<string>a&amp;&lt;b&gt;&quot;&apos;.png</string>");
  expect(result.stdout).toContain("<string>A&amp;&lt;B&gt;&quot;&apos;</string>");
});


it("persists properties through separate VFS command invocations", async () => {
  const files = new Map([["/vfs/in.png", await sharp({ create: { width: 3, height: 2, channels: 4, background: "green" } }).png().toBuffer()]]);
  const output: string[] = [];
  for (const argv of [["-s", "description", "VFS roundtrip", "in.png"], ["-g", "description", "in.png"], ["-d", "dpiWidth", "in.png"], ["-g", "dpiWidth", "in.png"]]) {
    const args = createCommandArguments(argv);
    const context = {
      command: "sips", args: args.args, argumentValues: args, cwd: "/vfs", env: {}, signal: new AbortController().signal,
      stdout: { async write(bytes: Uint8Array) { output.push(new TextDecoder().decode(bytes)); } }, stderr: { async write() {} }, registerCleanup() {},
      fs: {
        async readFile(path: string) { const bytes = files.get(path); if (!bytes) throw new Error("missing"); return bytes.slice(); },
        async writeFile(path: string, bytes: Uint8Array) { files.set(path, bytes.slice()); }, async mkdir() {}
      }
    } as unknown as CommandContext;
    expect((await createSipsCommand().execute(context)).exitCode).toBe(0);
  }
  expect(output.join("")).toContain("description: VFS roundtrip");
  expect(output.join("")).toContain("dpiWidth: <nil>");
});
