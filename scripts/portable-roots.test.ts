import { expect, it } from "vitest";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

const root = resolve(import.meta.dirname, "..");
const manifest = (name: string) => JSON.parse(readFileSync(resolve(root, `packages/${name}/package.json`), "utf8"));

it.each(["workerd", "browser"])("exposes portable root APIs under %s without Node globals", async condition => {
  const fs = manifest("safe-fs");
  const js = manifest("safe-js");
  expect(js.exports["."][condition]).toBe("./dist/core.js");
  expect(js.exports["."].types[condition]).toBe("./dist/core.d.ts");
  expect(fs.exports["."][condition]).toBe("./dist/core.js");
  const result = await build({
    stdin: { contents: `
      import { S3FileSystem, MockS3Client, createS3Transport } from './packages/safe-fs/src/core.ts';
      import * as js from './packages/safe-js/src/core.ts';
      import { joinPath } from './packages/safe-fs/src/contracts/index.ts';
      export async function verify() {
        for (const name of ['makeFsModule', 'makeEnvModule', 'makeTimeModule', 'makeFailModule', 'makeMetricModule', 'makeHarnessModule'])
          if (typeof js[name] !== 'function') throw new Error(name);
        if (js.makeEnvModule({ allow: ['VALUE'], values: { VALUE: 'portable' } }).get('VALUE') !== 'portable') throw new Error('env');
        const fs = new S3FileSystem({ bucket: 'portable', transport: createS3Transport(new MockS3Client({ buckets: ['portable'] })) });
        await fs.writeFile(joinPath('/', 'file.txt'), new TextEncoder().encode('portable'));
        if (new TextDecoder().decode(await fs.readFile('/file.txt')) !== 'portable') throw new Error('S3 read');
        await fs.rm('/file.txt');
      }`, resolveDir: root },
    bundle: true, write: false, platform: "browser", conditions: [condition], format: "cjs",
    alias: {
      "#safe-js-platform": resolve(root, "packages/safe-js/src/platform/workerd.ts"),
      "#safe-js-atomic-wait": resolve(root, "packages/safe-js/src/platform/atomic-wait-workerd.ts"),
      "#safe-fs-platform-path": resolve(root, "packages/safe-fs/src/platform/browser-path.ts"),
      "@poe-code/xml-ast": resolve(root, "packages/xml-ast/src/index.ts"),
      "@poe-code/safe-fs/core": resolve(root, "packages/safe-fs/src/core.ts"),
      "@poe-code/safe-fs": resolve(root, "packages/safe-fs/src/core.ts"),
    },
  });
  const module = { exports: {} as { verify(): Promise<void> } };
  runInNewContext(result.outputFiles[0]!.text, { module, exports: module.exports, TextEncoder, TextDecoder, crypto, structuredClone, setTimeout, clearTimeout, AbortController, AbortSignal, URL, DOMException, Uint8Array, ArrayBuffer });
  await module.exports.verify();
});
