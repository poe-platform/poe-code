import { spawn } from "node:child_process";
import type { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

/** Compile once, while retaining a fresh default-stack Node process per case. */
export async function prepareNativeModelScript(body: string) {
  const result = await build({
    stdin: {
      contents: `import { readFile } from "node:fs";
import { Volume } from "memfs";
import * as api from "./index.js";
import { ModelStore } from "./model-store.js";
import { archiveSettings } from "./archive.js";
console.log("ready");
const request = await new Promise((resolve, reject) => readFile(3, "utf8", (error, data) => {
  if (error) reject(error);
  else { try { resolve(JSON.parse(data)); } catch (error) { reject(error); } }
}));
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
  return async (signal: AbortSignal) => {
    const child = spawn(process.execPath, ["--input-type=module"], { signal, stdio: ["pipe", "pipe", "pipe", "pipe"] });
    const input = child.stdio[3] as Writable;
    let stdout = "", stderr = "";
    let resolveReady!: () => void, rejectReady!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    let started = false;
    child.stdout.on("data", bytes => {
      stdout += String(bytes);
      if (!started && stdout.startsWith("ready\n")) {
        started = true;
        stdout = stdout.slice("ready\n".length);
        resolveReady();
      }
    });
    child.stderr.on("data", bytes => { stderr += String(bytes); });
    const completion = new Promise<string>((resolve, reject) => {
      child.on("error", reject);
      child.stdin.on("error", reject);
      input.on("error", reject);
      child.on("close", code => {
        if (code !== 0 || !started) reject(new Error(stderr || "Native model exited before becoming ready"));
        else resolve(stdout);
      });
    });
    void completion.catch(rejectReady);
    // Separate pipes keep compilation and imports in setup, and model work in the test.
    child.stdin.end(script);
    await ready;
    return {
      run(request: unknown): Promise<string> {
        input.end(JSON.stringify(request));
        return completion;
      },
      async dispose(): Promise<void> {
        if (child.exitCode === null && !child.killed) child.kill();
        await completion.catch(() => {});
      }
    };
  };
}
