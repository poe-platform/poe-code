import fs from "node:fs";
import path from "node:path";
import { admit, bounded, grant } from "./support.mjs";

const root = "/private/tmp/safe-bash-b2-runtime-r8";
try {
  if (!fs.fstatSync(1).isFile() || !fs.fstatSync(2).isFile()) throw new Error("real outer direct-file descriptors required before preauth");
  const authority = grant(JSON.parse(bounded(process.argv[2], 16384)));
  const packetFile = new URL("../PACKET.json", import.meta.url).pathname;
  const packet = JSON.parse(admit(packetFile, { bytes: Number(process.argv[3]), sha256: authority.packetSha256 }, 1048576));
  const stageRoot = path.dirname(packetFile);
  for (const row of packet.files) admit(path.join(stageRoot, row.path), row);
  if (fs.existsSync(root)) throw new Error("fresh runtime work root required");
  fs.mkdirSync(root, { mode: 0o700 });
  const coordinator = await import("./coordinator.mjs");
  await coordinator.main(process.argv[2], stageRoot, packet);
  if (fs.fstatSync(1).size > 2097152) throw new Error("outer capture cap");
} catch (error) {
  process.stderr.write(JSON.stringify({ status: "STOP", primary: String(error?.stack ?? error).slice(0, 65536), noSuccessSchema: true }) + "\n"); process.exitCode = 78;
}
