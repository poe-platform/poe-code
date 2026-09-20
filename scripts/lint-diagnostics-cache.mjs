import { createHash } from "node:crypto";
import path from "node:path";

export function createLintDiagnosticsCache({ root, store, salt }) {
  const configurations = new WeakMap();
  const keyFor = ({ filename, bytes, configuration }) => {
    const parserOptions = configuration.languageOptions?.parserOptions;
    if (configuration.processor || parserOptions?.project || parserOptions?.projectService) return null;
    if (!configurations.has(configuration)) configurations.set(configuration,
      createHash("sha256").update(JSON.stringify(configuration)).digest("hex"));
    return createHash("sha256").update(salt).update(configurations.get(configuration))
      .update(path.relative(root, filename)).update(bytes).digest("hex");
  };
  return {
    read(subject) {
      const key = keyFor(subject);
      if (!key) return null;
      const record = store.read(key);
      const result = record?.result;
      if (record?.success !== true || !Array.isArray(result?.messages) || result.messages.length
        || result.errorCount !== 0 || result.warningCount !== 0 || result.fatalErrorCount !== 0) return null;
      return { ...result, filePath: subject.filename };
    },
    save(subject, result) {
      const key = keyFor(subject);
      if (key && result.errorCount === 0 && result.warningCount === 0 && result.fatalErrorCount === 0 && result.messages.length === 0) {
        store.write(key, { success: true, result: { ...result, filePath: path.relative(root, result.filePath) } });
      }
    }
  };
}
