import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

/** Compile once, while retaining a fresh default-stack Node process per case. */
export async function prepareNativeModelScript(body: string) {
  const result = await build({
    stdin: {
      contents: `import { Volume } from "memfs";
import * as api from "./index.js";
import { ModelStore } from "./model-store.js";
import { archiveSettings } from "./archive.js";
const request = __docxNativeRequest;
${body}`,
      resolveDir: fileURLToPath(new URL("../../src/", import.meta.url)),
      loader: "js"
    },
    bundle: true,
    packages: "external",
    platform: "node",
    format: "esm",
    target: "node22",
    write: false
  });
  const script = result.outputFiles[0]!.text;
  return (request: unknown, signal: AbortSignal): Promise<string> => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module"], { signal, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", bytes => { stdout += String(bytes); });
    child.stderr.on("data", bytes => { stderr += String(bytes); });
    child.on("error", reject);
    child.stdin.on("error", reject);
    child.on("close", code => { if (code !== 0) reject(new Error(stderr)); else resolve(stdout); });
    // Stdin avoids command-line size limits for deep XML and the compiled graph.
    child.stdin.end(`const __docxNativeRequest = ${JSON.stringify(request)};\n${script}`);
  });
}
