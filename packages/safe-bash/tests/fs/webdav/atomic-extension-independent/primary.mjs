import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const output = join(dirname(import.meta.filename), "evidence", "primary");
await mkdir(output);
const files = ["request_server.py", "request_resolver.py", "lock_man/lock_manager.py", "fs_dav_provider.py", "wsgidav_app.py", "http_authenticator.py"];
const records = [];
for (const file of files) {
  const url = `https://raw.githubusercontent.com/mar10/wsgidav/v4.3.5/wsgidav/${file}`;
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const destination = `${file.replaceAll("/", "-")}.txt`;
  await writeFile(join(output, destination), bytes);
  records.push({ url, file: destination, status: response.status, retrievedAt: new Date().toISOString(),
    sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length,
    qualification: "primary tagged source only; no service distribution downloaded or installed" });
}
await writeFile(join(output, "sources.json"), JSON.stringify(records, null, 2) + "\n");
console.log(records.map(({ file, sha256 }) => ({ file, sha256 })));
