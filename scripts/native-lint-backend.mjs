import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

export function createNativeLintBackend({ root, fileSystem = fs, catalogue, invoke, confirm }) {
  const configurations = new WeakMap();
  const configurationFor = (configuration) => {
    if (configurations.has(configuration)) return configurations.get(configuration);
    const language = configuration.languageOptions;
    if (
      configuration.processor ||
      language?.parser?.meta?.name !== "typescript-eslint/parser" ||
      language.sourceType !== "module" ||
      language.parserOptions?.project ||
      language.parserOptions?.projectService
    )
      return null;
    const rules = {};
    for (const [name, setting] of Object.entries(configuration.rules ?? {})) {
      const values = Array.isArray(setting) ? setting : [setting];
      if (values[0] === 0 || values[0] === "off") continue;
      // Module syntax parsing already rejects legacy octal literals.
      if (name === "no-octal") continue;
      const scope = name.startsWith("@typescript-eslint/") ? "typescript" : "eslint";
      const rule = name.split("/").at(-1);
      if (name.includes("/") && !name.startsWith("@typescript-eslint/")) return null;
      const native =
        catalogue.find((entry) => entry.scope === scope && entry.value === rule) ??
        catalogue.find((entry) => entry.scope === "eslint" && entry.value === rule);
      if (!native) return null;
      rules[native.scope + "/" + native.value] = values;
    }
    const result = { plugins: ["typescript"], globals: language.globals ?? {}, rules };
    configurations.set(configuration, result);
    return result;
  };
  const admit = (subject) => {
    if (
      ![".ts", ".tsx", ".mts"].includes(path.extname(subject.filename)) ||
      !configurationFor(subject.configuration)
    )
      return false;
    const octal = subject.configuration.rules?.["no-octal"];
    const severity = Array.isArray(octal) ? octal[0] : octal;
    if (severity === undefined || severity === 0 || severity === "off") return true;
    const source = ts.createSourceFile(
      subject.filename,
      subject.bytes.toString("utf8"),
      ts.ScriptTarget.Latest
    );
    return source.statements.some(
      (statement) =>
        ts.isImportDeclaration(statement) ||
        ts.isExportDeclaration(statement) ||
        ts.isExportAssignment(statement) ||
        (ts.canHaveModifiers(statement) &&
          ts
            .getModifiers(statement)
            ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword))
    );
  };
  return {
    admit,
    async lint(subjects) {
      if (!subjects.length) return [];
      if (subjects.some((subject) => !admit(subject))) return Promise.all(subjects.map(confirm));
      const out = path.join(root, "out");
      fileSystem.mkdirSync(out, { recursive: true, mode: 0o700 });
      assert.equal(
        fileSystem.realpathSync(out),
        out,
        "Native snapshots must remain inside the checkout"
      );
      const directory = fileSystem.mkdtempSync(path.join(out, "native-lint-"));
      try {
        const groups = new Map(),
          byFilename = new Map();
        const overrides = [];
        for (const [index, subject] of subjects.entries()) {
          const configuration = configurationFor(subject.configuration),
            signature = JSON.stringify(configuration);
          if (!groups.has(signature)) {
            const group = groups.size;
            groups.set(signature, group);
            overrides.push({ files: ["subjects/" + group + "/**"], ...configuration });
          }
          const filename = path.join(
            directory,
            "subjects",
            String(groups.get(signature)),
            String(index) + path.extname(subject.filename)
          );
          fileSystem.mkdirSync(path.dirname(filename), { recursive: true });
          fileSystem.writeFileSync(filename, subject.bytes, { mode: 0o600 });
          fileSystem.chmodSync(filename, 0o400);
          byFilename.set(filename, subject);
        }
        const config = path.join(directory, "config.json");
        fileSystem.writeFileSync(
          config,
          JSON.stringify({
            plugins: ["typescript"],
            categories: { correctness: "off" },
            overrides
          }),
          { mode: 0o600 }
        );
        fileSystem.chmodSync(config, 0o400);
        let positive;
        try {
          positive = new Set();
          const filenames = [...byFilename.keys()].map((filename) =>
            path.relative(directory, filename)
          );
          for (let offset = 0; offset < filenames.length; offset += 1000) {
            const batch = filenames.slice(offset, offset + 1000);
            const execution = await invoke(
              [
                "--config",
                config,
                "--format",
                "json",
                "--no-ignore",
                "--disable-nested-config",
                ...batch
              ],
              { cwd: directory }
            );
            assert.ok(execution.status === 0 || execution.status === 1, "Native execution failed");
            const result = JSON.parse(execution.stdout);
            assert.equal(result.number_of_files, batch.length, "Native lint skipped guarded files");
            assert.ok(Array.isArray(result.diagnostics), "Native diagnostics are missing");
            assert.ok(
              execution.status === 0 || result.diagnostics.length,
              "Native execution failed without diagnostics"
            );
            const requested = new Set(batch.map((filename) => path.resolve(directory, filename)));
            for (const diagnostic of result.diagnostics) {
              assert.equal(
                typeof diagnostic.filename,
                "string",
                "Native diagnostic has no subject"
              );
              const filename = path.resolve(directory, diagnostic.filename),
                subject = byFilename.get(filename);
              assert.ok(
                subject && requested.has(filename),
                "Native diagnostic refers to an unguarded subject"
              );
              positive.add(subject);
            }
          }
        } catch {
          positive = new Set(subjects);
        }
        return await Promise.all(
          subjects.map((subject) =>
            positive.has(subject)
              ? confirm(subject)
              : {
                  filePath: subject.filename,
                  messages: [],
                  suppressedMessages: [],
                  errorCount: 0,
                  warningCount: 0,
                  fatalErrorCount: 0,
                  fixableErrorCount: 0,
                  fixableWarningCount: 0,
                  usedDeprecatedRules: []
                }
          )
        );
      } finally {
        fileSystem.rmSync(directory, { recursive: true, force: true });
      }
    }
  };
}
