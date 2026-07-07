import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const rootTscPath = path.join(repoRoot, "node_modules", "typescript", "bin", "tsc");

function run(command, args, options = {}) {
  return execFileSync(command, args, { cwd: repoRoot, encoding: "utf8", ...options });
}

function packPackage(relativeDir, packDir) {
  const result = JSON.parse(
    run("npm", ["pack", path.join(repoRoot, relativeDir), "--json", "--pack-destination", packDir])
  );
  return path.join(packDir, result[0].filename);
}

function listTarEntries(tarballPath) {
  return execFileSync("tar", ["-tzf", tarballPath], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

function readTarJson(tarballPath, entryPath) {
  return JSON.parse(execFileSync("tar", ["-xOzf", tarballPath, entryPath], { encoding: "utf8" }));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function writeConsumerFixture(projectDir) {
  const openApiDocument = {
    openapi: "3.0.3",
    info: { title: "Smoke API", version: "1.0.0" },
    paths: {
      "/pets": {
        get: {
          operationId: "listPets",
          responses: {
            200: {
              description: "ok",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        name: { type: "string" }
                      },
                      required: ["id", "name"]
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  };

  writeFileSync(
    path.join(projectDir, "package.json"),
    JSON.stringify({ name: "toolcraft-consumer-smoke", private: true, type: "module" }, null, 2) +
      "\n"
  );
  writeFileSync(
    path.join(projectDir, "openapi.json"),
    JSON.stringify(openApiDocument, null, 2) + "\n"
  );
  writeFileSync(
    path.join(projectDir, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          module: "NodeNext",
          moduleResolution: "NodeNext",
          target: "ES2022",
          noEmit: true,
          strict: true,
          skipLibCheck: true
        },
        include: ["src/**/*.ts"]
      },
      null,
      2
    ) + "\n"
  );
}

function runConsumerSmoke(projectDir, tarballs) {
  execFileSync("npm", ["install", ...tarballs], { cwd: projectDir, stdio: "inherit" });

  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      [
        'await import("toolcraft");',
        'const toolcraftCli = await import("toolcraft/cli");',
        'if (typeof toolcraftCli.createCLICommandTreeSnapshot !== "function") throw new Error("Missing createCLICommandTreeSnapshot export.");',
        'if (typeof toolcraftCli.renderErrorReport !== "function") throw new Error("Missing renderErrorReport export.");',
        'const { loadToolcraftComposition } = await import("toolcraft/composition");',
        "const composition = await loadToolcraftComposition();",
        'if (composition.schemaVersion !== 1 || !composition.packages.some(({ name }) => name === "toolcraft")) throw new Error("Invalid Toolcraft composition manifest.");',
        'await import("toolcraft/design");',
        'const fileChanges = await import("toolcraft/file-changes");',
        'if (typeof fileChanges.createFileChangeRenderers !== "function") throw new Error("Missing createFileChangeRenderers export.");',
        'await import("toolcraft/agent-defs");',
        'await import("toolcraft/agent-human-in-loop");',
        'await import("toolcraft/agent-mcp-config");',
        'await import("toolcraft/auth-store");',
        'await import("toolcraft/config-mutations");',
        'await import("toolcraft/frontmatter");',
        'await import("toolcraft/mcp");',
        'await import("toolcraft/mcp-proxy");',
        'await import("toolcraft/process-runner");',
        'await import("toolcraft/sdk");',
        'await import("toolcraft/human-in-loop");',
        'await import("toolcraft/task-list");',
        'await import("toolcraft/tiny-mcp-client");'
      ].join("\n")
    ],
    { cwd: projectDir, stdio: "inherit" }
  );

  const generatorPath = path.join(
    projectDir,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "toolcraft-openapi-generate.cmd" : "toolcraft-openapi-generate"
  );

  execFileSync(generatorPath, ["--input", "openapi.json", "--output", "src/generated"], {
    cwd: projectDir,
    stdio: "inherit"
  });

  assert(
    existsSync(path.join(projectDir, "src", "generated", "index.ts")),
    "Expected generated index.ts."
  );
  const generatedIndex = readFileSync(
    path.join(projectDir, "src", "generated", "index.ts"),
    "utf8"
  );
  assert(
    generatedIndex.includes('from "toolcraft"'),
    'Expected generated code to import "toolcraft".'
  );

  const generatedCommand = readFileSync(
    path.join(projectDir, "src", "generated", "pets", "list.ts"),
    "utf8"
  );
  assert(
    generatedCommand.includes('from "toolcraft-openapi"'),
    'Expected generated code to import "toolcraft-openapi".'
  );

  mkdirSync(path.join(projectDir, "src"), { recursive: true });
  writeFileSync(
    path.join(projectDir, "src", "file-changes.ts"),
    [
      'import { createFileChangeRenderers } from "toolcraft/file-changes";',
      'import type { FileChange } from "toolcraft";',
      'const changes = [{ kind: "added", path: "flows/morning.json" }] satisfies FileChange[];',
      "createFileChangeRenderers().json?.({ changes }, {} as never);"
    ].join("\n") + "\n"
  );

  execFileSync(process.execPath, [rootTscPath, "-p", "tsconfig.json"], {
    cwd: projectDir,
    stdio: "inherit"
  });
}

function runOptionalDependencySmoke(projectDir, toolcraftTarball) {
  writeFileSync(
    path.join(projectDir, "package.json"),
    JSON.stringify(
      {
        name: "toolcraft-optional-consumer-smoke",
        private: true,
        type: "module",
        devDependencies: {
          eslint: "9.39.4"
        },
        optionalDependencies: {
          toolcraft: `file:${toolcraftTarball}`
        }
      },
      null,
      2
    ) + "\n"
  );

  execFileSync("npm", ["install", "--package-lock-only"], {
    cwd: projectDir,
    stdio: "inherit"
  });
  rmSync(path.join(projectDir, "node_modules"), { recursive: true, force: true });
  execFileSync("npm", ["ci", "--ignore-scripts"], { cwd: projectDir, stdio: "inherit" });
  execFileSync("npm", ["ls", "ajv", "--all"], { cwd: projectDir, stdio: "inherit" });
  execFileSync(
    process.execPath,
    ["--input-type=module", "--eval", 'await import("toolcraft/mcp");'],
    { cwd: projectDir, stdio: "inherit" }
  );
}

const packDir = mkdtempSync(path.join(os.tmpdir(), "toolcraft-pack-"));
const consumerDir = mkdtempSync(path.join(os.tmpdir(), "toolcraft-consumer-"));
const optionalConsumerDir = mkdtempSync(path.join(os.tmpdir(), "toolcraft-optional-consumer-"));

try {
  const tarballs = {
    agentKit: packPackage("packages/toolcraft", packDir),
    agentKitSchema: packPackage("packages/toolcraft-schema", packDir),
    agentKitOpenApi: packPackage("packages/toolcraft-openapi", packDir)
  };

  const toolcraftPackageJson = readTarJson(tarballs.agentKit, "package/package.json");
  const toolcraftComposition = readTarJson(tarballs.agentKit, "package/composition.json");
  const toolcraftSchemaPackageJson = readTarJson(tarballs.agentKitSchema, "package/package.json");
  assert(toolcraftPackageJson.license === "MIT", "Expected toolcraft to declare the MIT license.");
  assert(
    toolcraftSchemaPackageJson.license === "MIT",
    "Expected toolcraft-schema to declare the MIT license."
  );
  const bundledRuntimeDependencies = toolcraftPackageJson.bundleDependencies ?? [];
  assert(
    toolcraftPackageJson.toolcraftComposition === "./composition.json",
    "Expected toolcraft to advertise its composition manifest."
  );
  assert(toolcraftComposition.schemaVersion === 1, "Expected composition schema version 1.");
  assert(
    Array.isArray(bundledRuntimeDependencies) && bundledRuntimeDependencies.length > 0,
    "Expected toolcraft to declare bundled runtime dependencies."
  );
  const packAssertions = [
    {
      tarball: tarballs.agentKit,
      requiredEntries: [
        "package/dist/index.js",
        "package/dist/cli.js",
        "package/dist/design.js",
        "package/dist/file-change-renderer.js",
        "package/composition.json",
        "package/LICENSE",
        ...bundledRuntimeDependencies.map(
          (dependencyName) => `package/node_modules/${dependencyName}/package.json`
        )
      ]
    },
    {
      tarball: tarballs.agentKitSchema,
      requiredEntries: ["package/dist/index.js", "package/LICENSE"]
    },
    {
      tarball: tarballs.agentKitOpenApi,
      requiredEntries: [
        "package/dist/index.js",
        "package/dist/bin/generate.js",
        "package/node_modules/toolcraft-design/package.json",
        "package/node_modules/auth-store/package.json"
      ]
    }
  ];

  for (const { tarball, requiredEntries } of packAssertions) {
    const entries = new Set(listTarEntries(tarball));
    for (const requiredEntry of requiredEntries) {
      assert(
        entries.has(requiredEntry),
        `Expected ${path.basename(tarball)} to include ${requiredEntry}.`
      );
    }
  }

  for (const dependencyName of bundledRuntimeDependencies) {
    const bundledPackagePath = `package/node_modules/${dependencyName}`;
    const bundledPackageJson = readTarJson(tarballs.agentKit, `${bundledPackagePath}/package.json`);
    assert(
      typeof bundledPackageJson.license === "string" && bundledPackageJson.license.length > 0,
      `Expected bundled ${dependencyName} to declare a license.`
    );
    assert(
      toolcraftPackageJson.optionalDependencies?.[dependencyName] ??
        toolcraftPackageJson.dependencies?.[dependencyName],
      `Expected bundled ${dependencyName} to be declared as a runtime dependency.`
    );
  }

  const compositionByName = new Map(
    toolcraftComposition.packages.map((entry) => [entry.name, entry])
  );
  assert(
    compositionByName.get("toolcraft")?.version === toolcraftPackageJson.version,
    "Expected composition to include the exact toolcraft version."
  );
  for (const dependencyName of bundledRuntimeDependencies) {
    const bundledPackageJson = readTarJson(
      tarballs.agentKit,
      `package/node_modules/${dependencyName}/package.json`
    );
    assert(
      compositionByName.get(dependencyName)?.version === bundledPackageJson.version,
      `Expected composition to include exact version for ${dependencyName}.`
    );
    assert(
      compositionByName.get(dependencyName)?.license === bundledPackageJson.license,
      `Expected composition to include the license for ${dependencyName}.`
    );
  }

  writeConsumerFixture(consumerDir);
  runConsumerSmoke(consumerDir, Object.values(tarballs));
  runOptionalDependencySmoke(optionalConsumerDir, tarballs.agentKit);

  console.log("toolcraft standalone publish smoke passed.");
} finally {
  rmSync(packDir, { recursive: true, force: true });
  rmSync(consumerDir, { recursive: true, force: true });
  rmSync(optionalConsumerDir, { recursive: true, force: true });
}
