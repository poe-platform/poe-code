import { expect, it } from "vitest";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

const root = resolve(import.meta.dirname, "..");
const manifest = (name: string) => JSON.parse(readFileSync(resolve(root, `packages/${name}/package.json`), "utf8"));

it.each(["workerd", "browser"])("exposes the S3 HTTP transport through the portable shell under %s", async condition => {
  const result = await build({
    stdin: { contents: `
      export { createS3HttpTransport } from './packages/safe-bash/src/fs/s3/http/index.ts';
    `, resolveDir: root },
    bundle: true, write: false, platform: "browser", conditions: [condition], format: "cjs",
    alias: {
      "@poe-code/safe-fs/core": resolve(root, "packages/safe-fs/src/core.ts"),
      "@poe-code/safe-fs": resolve(root, "packages/safe-fs/src/core.ts"),
      "#safe-fs-s3-request": resolve(root, "packages/safe-fs/src/fs/s3/http/request-fetch.ts"),
      "#safe-fs-platform-path": resolve(root, "packages/safe-fs/src/platform/browser-path.ts"),
    },
  });
  const module = { exports: {} as { createS3HttpTransport: typeof import("../packages/safe-fs/src/fs/s3/http/index.js").createS3HttpTransport } };
  const requests: string[] = [];
  runInNewContext(result.outputFiles[0]!.text, {
    module, exports: module.exports, TextEncoder, TextDecoder, setTimeout, clearTimeout,
    AbortController, AbortSignal, URL, Uint8Array, ArrayBuffer,
    fetch: async (url: string, options: RequestInit) => {
      requests.push(url);
      expect(options.method).toBe("GET");
      expect(new Headers(options.headers).get("authorization")).toContain("AWS4-HMAC-SHA256");
      return new Response("portable", { headers: { "content-length": "8" } });
    },
  });
  const transport = module.exports.createS3HttpTransport({
    endpoint: "https://s3.example.test", region: "us-east-1",
    credentials: { accessKeyId: "test", secretAccessKey: "test" }, addressingStyle: "path",
  });
  const response = await transport.getObject({ Bucket: "portable", Key: "file.txt" });
  expect(new TextDecoder().decode(response.Body)).toBe("portable");
  expect(requests).toEqual(["https://s3.example.test/portable/file.txt"]);
  if (condition === "workerd") {
    const { Miniflare } = await import("miniflare");
    const runtime = new Miniflare({ modules: true, cf: false, compatibilityDate: "2026-07-01",
      outboundService: () => new Response("portable", { headers: { "content-length": "8" } }),
      script: `const module = { exports: {} }; ${result.outputFiles[0]!.text}
        export default { async fetch() {
          const transport = module.exports.createS3HttpTransport({
            endpoint: 'https://s3.example.test', region: 'us-east-1',
            credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
          });
          const response = await transport.getObject({ Bucket: 'portable', Key: 'file.txt' });
          return new Response(response.Body);
        } };`,
    });
    try {
      const response = await runtime.dispatchFetch("https://portable.test");
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("portable");
    } finally { await runtime.dispose(); }
  }
});

it.each(["workerd", "browser"])("exposes portable root APIs under %s without Node globals", async condition => {
  const fs = manifest("safe-fs");
  const js = manifest("safe-js");
  const entry = condition === "workerd" ? "workerd" : "core";
  expect(js.exports["."][condition]).toBe(`./dist/${entry}.js`);
  expect(js.exports["."].types[condition]).toBe(`./dist/${entry}.d.ts`);
  expect(fs.exports["."][condition]).toBe("./dist/core.js");
  const result = await build({
    stdin: { contents: `
      import { S3FileSystem, MockS3Client, createS3Transport } from './packages/safe-fs/src/core.ts';
      import * as js from './packages/safe-js/src/${entry}.ts';
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
