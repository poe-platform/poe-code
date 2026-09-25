import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "import-meta-resolve";

/** Compile a source fixture in memory so native-stack checks pay no TS loader startup. */
export async function nativeModule(source: string | URL): Promise<string> {
  const result = await build({
    ...(source instanceof URL ? { entryPoints: [fileURLToPath(source)] } : {
      stdin: { contents: source, sourcefile: "native-depth-fixture.mjs", resolveDir: fileURLToPath(new URL("../../../../", import.meta.url)) }
    }),
    bundle: true, write: false, platform: "node", format: "esm", target: "node22", packages: "external",
    plugins: [{ name: "fixture-file-urls", setup(builder) {
      builder.onResolve({ filter: /^file:/ }, args => ({ path: fileURLToPath(args.path) }));
      builder.onResolve({ filter: /^[^./]/ }, args => ({ path: resolve(args.path, args.importer ? pathToFileURL(args.importer).href : import.meta.url), external: true }));
    } }]
  });
  return result.outputFiles[0]!.text;
}

// The source travels through stdin rather than exceeding the host argv ceiling.
export const nativeModuleLoader = String.raw`
let input = "", source;
for await (const chunk of process.stdin.iterator({ destroyOnReturn: false })) {
  input += chunk;
  const separator = input.indexOf("\n");
  if (separator < 0) continue;
  source = JSON.parse(input.slice(0, separator));
  process.stdin.unshift(Buffer.from(input.slice(separator + 1)));
  break;
}
await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
`;
