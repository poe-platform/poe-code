import path from "node:path";
import { native } from "./native.js";
const length = value => value.length, difference = (left, right) => left - right;
export function mapAcpEventToSessionUpdates(event) {
  return native.mapAgentTranscript(event, length, difference);
}
export function createTranscriptWriter(options) {
  const join = options.pathJoin ?? path.join;
  let filePath;
  if (options.logPath) filePath = options.logPath;
  else if (options.logDir && options.logFileName) filePath = join(options.logDir, options.logFileName);
  else throw new Error("createTranscriptWriter requires logPath or logDir + logFileName.");
  let dirEnsured;
  const logDir = path.dirname(filePath);
  return {
    filePath,
    async write(event) {
      const updates = mapAcpEventToSessionUpdates(event);
      if (updates.length === 0) return;
      await ensureNoSymbolicLinkPath(options.fs, filePath);
      if (!dirEnsured) dirEnsured = options.fs.mkdir(logDir, { recursive: true });
      await dirEnsured;
      await ensureNoSymbolicLinkPath(options.fs, filePath);
      const payload = updates.map(update => `${JSON.stringify(update)}\n`).join("");
      await options.fs.appendFile(filePath, payload);
    },
    async close() {}
  };
}
async function ensureNoSymbolicLinkPath(fs, filePath) {
  const absolutePath = path.resolve(filePath), root = path.parse(absolutePath).root;
  let inspectedPath = root;
  for (const segment of absolutePath.slice(root.length).split(path.sep).filter(Boolean)) {
    inspectedPath = path.join(inspectedPath, segment);
    try {
      if ((await fs.lstat(inspectedPath)).isSymbolicLink())
        throw new Error(`Transcript log path may not contain symbolic links: ${filePath}`);
    } catch (error) {
      if (error !== null && typeof error === "object" && Object.hasOwn(error, "code") && error.code === "ENOENT") return;
      throw error;
    }
  }
}
