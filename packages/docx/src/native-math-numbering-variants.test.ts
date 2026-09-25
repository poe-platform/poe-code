import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { beforeAll, expect, it, onTestFinished } from "vitest";

import { nativeModule, nativeModuleLoader } from "../tests/fixtures/native-module.js";

const fixture = new URL("../tests/fixtures/deep-numbering-native-math-worker.ts", import.meta.url);
let source: string;
beforeAll(async () => {
  // The worker is importable; invoke its exported entry explicitly after compilation.
  source = await nativeModule(`import { run } from ${JSON.stringify(fixture.href)}; console.log(JSON.stringify(await run(process.argv.slice(2))));`);
});

const all: { strict: boolean; kind: string; prefix: string; carrier: string; codec: string; route: string; action: string; radicals: number }[] = [];
for (const strict of [false, true]) for (const kind of ["docx", "dotx"])
for (const prefix of ["w", "alternate", "default"]) for (const carrier of ["direct", "choice", "fallback", "process"])
for (const codec of ["utf8", "bom", "le", "be"]) for (const route of ["sdk", "sdk-batch", "cli", "cli-batch"])
for (const action of ["edit", "dry"]) for (const radicals of [32, 1280, 1792]) all.push({ strict, kind, prefix, carrier, codec, route, action, radicals });
for (let sample = 0; sample < 48; sample++) {
  const identity = all[sample * 97 % all.length]!;
  it(`preserves native math and opaque numbering through independent variant dispatch; ${JSON.stringify(identity)}`, async () => {
    const { strict, kind, prefix, carrier, codec, route, action, radicals } = identity;
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, ["--input-type=module", "-e", nativeModuleLoader, fileURLToPath(fixture), strict ? "strict" : "transitional", String(radicals), route, action, kind, prefix, carrier, codec], { stdio: ["pipe", "pipe", "pipe"] });
      let output = "", errors = "";
      onTestFinished(() => { if (child.exitCode === null) child.kill(); });
      child.stdout.on("data", bytes => { output += String(bytes); });
      child.stderr.on("data", bytes => { errors += String(bytes); });
      child.on("error", reject); child.stdin.on("error", reject);
      child.on("close", status => status === 0 ? resolve(output) : reject(new Error(errors)));
      child.stdin.end(JSON.stringify(source) + "\n");
    });
    expect(JSON.parse(stdout)).toEqual({ strict, radicals, exactNativeMathAndNumberingPreservation: true, route, dryRun: action === "dry", actualPublicDispatchAndRetention: true, kind, prefix, carrier, codec, exactDirtyFramingCodecRTLAndOpaqueSignatureInteraction: true });
  });
}
