import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const encode = value => Buffer.from(value).toString("base64");
const hashFile = async url => createHash("sha256").update(await readFile(new URL(url))).digest("hex");

function quote(word) {
  return `'${word.replaceAll("'", `'\\''`)}'`;
}

async function seed(api) {
  const fs = api.createMemoryFileSystem();
  for (const directory of ["/empty", "/nest", "/nest/deep"]) await fs.mkdir(directory);
  for (const path of ["/alpha.txt", "/nest/beta.txt", "/nest/deep/gamma.txt"]) {
    await fs.writeFile(path, new Uint8Array());
  }
  return fs;
}

export async function runBoundary({ api, boundary, caseRecord, entryUrl, treeUrl }) {
  const registry = api.createAgentCommands();
  const names = registry.map(command => command.name);
  const fs = await seed(api);
  const controller = new AbortController();
  let deadlineExceeded = false;
  const deadline = setTimeout(() => {
    deadlineExceeded = true;
    controller.abort(new Error("worker invocation deadline exceeded"));
  }, 3000);
  const shell = new api.Shell({
    fs,
    cwd: "/",
    env: Object.assign(Object.create(null), caseRecord.env),
    limits: { maxOutputBytes: 65536 },
  }).use(api.agentCommands());
  let disposed = false;
  try {
    const command = ["tree", ...caseRecord.args].map(quote).join(" ");
    const result = await shell.exec(command, { signal: controller.signal });
    return {
      schemaVersion: 1,
      boundary,
      caseId: caseRecord.id,
      command,
      explicitVirtualEnvironment: caseRecord.env,
      registry: { count: names.length, hasTree: names.includes("tree"), names },
      loaded: {
        entryPath: fileURLToPath(entryUrl),
        entrySha256: await hashFile(entryUrl),
        treePath: fileURLToPath(treeUrl),
        treeSha256: await hashFile(treeUrl),
      },
      invocation: {
        exitCode: result.exitCode,
        stdoutBase64: encode(result.stdout),
        stdoutBytes: Buffer.byteLength(result.stdout),
        stderrBase64: encode(result.stderr),
        stderrBytes: Buffer.byteLength(result.stderr),
        deadlineExceeded,
      },
    };
  } finally {
    clearTimeout(deadline);
    await shell.dispose();
    disposed = true;
    if (!disposed) throw new Error("shell disposal did not settle");
  }
}
