import * as native from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRealFileSystem } from "../../../src/fs/real/index.js";
import { binary, sourceState } from "../../fs/conformance/fixtures.js";

const root = await native.mkdtemp(join(tmpdir(), "virtual-bash-atime-probe-"));
const anomalies: Record<"native" | "adapter", { index: number; atimeMs: number; mtimeMs: number; hostAtimeMs?: number }[]> = {
  native: [], adapter: [],
};
try {
  const fs = await createRealFileSystem({ root });
  for (let index = 0; index < 500; index++) {
    const hostPath = join(root, `native-${index}`);
    await native.writeFile(hostPath, binary);
    await native.chmod(hostPath, 0o600);
    await native.stat(hostPath);
    await native.utimes(hostPath, 10, 20);
    const host = await native.stat(hostPath);
    if (host.atimeMs !== 10000 || host.mtimeMs !== 20000) {
      anomalies.native.push({ index, atimeMs: host.atimeMs, mtimeMs: host.mtimeMs });
    }
    const path = `/adapter-${index}`;
    await fs.writeFile(path, binary);
    await fs.chmod(path, 0o600);
    await fs.stat(path);
    await fs.utimes(path, 10000, 20000);
    const stat = await fs.stat(path);
    if (stat.atimeMs !== 10000 || stat.mtimeMs !== 20000) {
      anomalies.adapter.push({ index, atimeMs: stat.atimeMs, mtimeMs: stat.mtimeMs,
        hostAtimeMs: (await native.stat(join(root, path))).atimeMs });
    }
  }
  console.log(JSON.stringify({
    iterationsPerBackend: 500, expectedAtimeMs: 10000, expectedMtimeMs: 20000,
    platform: process.platform, node: process.version,
    sourceSha256: await sourceState(), anomalies,
  }, null, 2));
} finally {
  await native.rm(root, { recursive: true, force: true });
}
