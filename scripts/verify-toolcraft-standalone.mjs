import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
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
        'await import("toolcraft/cli");',
        'await import("toolcraft/design");',
        'await import("toolcraft/mcp");',
        'await import("toolcraft/mcp-proxy");',
        'await import("toolcraft/sdk");',
        'await import("toolcraft/human-in-loop");'
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

  execFileSync(process.execPath, [rootTscPath, "-p", "tsconfig.json"], {
    cwd: projectDir,
    stdio: "inherit"
  });
}

const packDir = mkdtempSync(path.join(os.tmpdir(), "toolcraft-pack-"));
const consumerDir = mkdtempSync(path.join(os.tmpdir(), "toolcraft-consumer-"));

try {
  const tarballs = {
    agentKit: packPackage("packages/toolcraft", packDir),
    agentKitSchema: packPackage("packages/toolcraft-schema", packDir),
    agentKitOpenApi: packPackage("packages/toolcraft-openapi", packDir)
  };

  const toolcraftPackageJson = readTarJson(tarballs.agentKit, "package/package.json");
  const bundledRuntimeDependencies = toolcraftPackageJson.bundleDependencies ?? [];
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
        ...bundledRuntimeDependencies.map(
          (dependencyName) => `package/node_modules/${dependencyName}/package.json`
        )
      ]
    },
    {
      tarball: tarballs.agentKitSchema,
      requiredEntries: ["package/dist/index.js"]
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
    assert(
      toolcraftPackageJson.optionalDependencies?.[dependencyName],
      `Expected bundled ${dependencyName} to be an optional dependency for standalone installers.`
    );
    assert(
      !toolcraftPackageJson.dependencies?.[dependencyName],
      `Expected bundled ${dependencyName} to be omitted from required dependencies.`
    );
  }

  writeConsumerFixture(consumerDir);
  runConsumerSmoke(consumerDir, Object.values(tarballs));

  console.log("toolcraft standalone publish smoke passed.");
} finally {
  rmSync(packDir, { recursive: true, force: true });
  rmSync(consumerDir, { recursive: true, force: true });
}
