import { createHash } from "node:crypto";
import path from "node:path";

export function createLintDiagnosticsCache({ root, store, salt, batchMode = false }) {
  const configurations = new WeakMap();
  const indexKey = createHash("sha256").update("lint-diagnostics-index-v1\0" + salt).digest("hex");
  const indexRecord = batchMode ? store.read(indexKey) : null;
  const cleanKeys = new Set(Array.isArray(indexRecord?.keys) ? indexRecord.keys : []);
  let dirty = false;
  const subjectKeys = new WeakMap();
  const keyFor = (subject) => {
    const { filename, bytes, configuration } = subject;
    if (!Buffer.isBuffer(bytes)) return subjectKeys.get(subject) ?? null;
    const parserOptions = configuration.languageOptions?.parserOptions;
    if (configuration.processor || parserOptions?.project || parserOptions?.projectService) return null;
    if (!configurations.has(configuration)) configurations.set(configuration,
      createHash("sha256").update(JSON.stringify(configuration)).digest("hex"));
    const key = createHash("sha256").update(salt).update(configurations.get(configuration))
      .update(path.relative(root, filename)).update(bytes).digest("hex");
    subjectKeys.set(subject, key);
    return key;
  };
  return {
    read(subject) {
      const key = keyFor(subject);
      if (!key) return null;
      if (batchMode) {
        if (!cleanKeys.has(key)) return null;
        return {
          filePath: subject.filename,
          messages: [],
          suppressedMessages: [],
          errorCount: 0,
          warningCount: 0,
          fatalErrorCount: 0,
          fixableErrorCount: 0,
          fixableWarningCount: 0,
          usedDeprecatedRules: []
        };
      }
      const record = store.read(key);
      const result = record?.result;
      if (record?.success !== true || !Array.isArray(result?.messages) || result.messages.length
        || result.errorCount !== 0 || result.warningCount !== 0 || result.fatalErrorCount !== 0) return null;
      return { ...result, filePath: subject.filename };
    },
    save(subject, result) {
      const key = keyFor(subject);
      if (key && result.errorCount === 0 && result.warningCount === 0 && result.fatalErrorCount === 0 && result.messages.length === 0) {
        if (batchMode) {
          if (!cleanKeys.has(key)) {
            cleanKeys.add(key);
            dirty = true;
          }
          return;
        }
        store.write(key, { success: true, result: { ...result, filePath: path.relative(root, result.filePath) } });
      }
    },
    flush() {
      if (batchMode && dirty) {
        store.write(indexKey, { success: true, keys: [...cleanKeys] });
        dirty = false;
      }
    }
  };
}
