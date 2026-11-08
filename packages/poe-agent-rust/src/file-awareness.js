import path from "node:path";
import { createRequire } from "node:module";
const native = createRequire(import.meta.url)("./poe-agent-rust.node");
export function createFileAwarenessTracker(cwd) {
  const tracker = new native.NativeFileAwareness();
  return {
    recordRead(filePath) {
      tracker.read(path.resolve(cwd, filePath));
    },
    recordWrite(filePath) {
      tracker.write(path.resolve(cwd, filePath));
    },
    snapshot() {
      const [read, modified] = tracker.snapshot();
      return { readFiles: new Set(read), modifiedFiles: new Set(modified) };
    }
  };
}
function effect(tool) {
  return typeof tool === "string" ? native.fileAwarenessToolEffect(tool) : 0;
}
export function recordToolFileAwareness(options) {
  const args = options.args;
  if (typeof args !== "object" || args === null || Array.isArray(args)) return;
  const filePath = args.path;
  if (typeof filePath !== "string" || !native.fileAwarenessPathAllowed(filePath)) return;
  if (effect(options.tool) === 1) {
    options.tracker.recordRead(filePath);
    return;
  }
  if (effect(options.tool) === 2 || effect(options.tool) === 3)
    options.tracker.recordWrite(filePath);
}
