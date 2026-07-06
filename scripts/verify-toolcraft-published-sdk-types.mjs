import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "toolcraft-published-sdk-types-"));
const packDir = path.join(fixtureRoot, "packs");
const producerDir = path.join(fixtureRoot, "producer");
const consumerDir = path.join(fixtureRoot, "consumer");

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    stdio: options.capture === true ? "pipe" : "inherit"
  });
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function pack(packageDir) {
  const output = run(
    "npm",
    ["pack", packageDir, "--pack-destination", packDir, "--json"],
    { capture: true }
  );
  const [{ filename }] = JSON.parse(output);
  return path.join(packDir, filename);
}

try {
  mkdirSync(packDir, { recursive: true });
  mkdirSync(path.join(producerDir, "src"), { recursive: true });
  mkdirSync(consumerDir, { recursive: true });

  const toolcraftTarball = pack(path.join(repoRoot, "packages", "toolcraft"));

  writeJson(path.join(producerDir, "package.json"), {
    name: "toolcraft-sdk-types-producer",
    version: "1.0.0",
    type: "module",
    main: "dist/index.js",
    types: "dist/index.d.ts",
    files: ["dist"],
    dependencies: {
      toolcraft: `file:${toolcraftTarball}`
    }
  });
  writeJson(path.join(producerDir, "tsconfig.json"), {
    compilerOptions: {
      strict: true,
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      declaration: true,
      outDir: "dist",
      rootDir: "src",
      typeRoots: [path.join(repoRoot, "node_modules", "@types")]
    },
    include: ["src"]
  });
  writeFileSync(
    path.join(producerDir, "src", "index.ts"),
    `import { defineCommand, defineGroup, S } from "toolcraft";

const lint = defineCommand({
  name: "lint",
  params: S.Object({ root: S.Optional(S.String()) }),
  handler: async () => ({ files: 1 }),
});

const inspect = defineCommand({
  name: "inspect",
  scope: ["mcp"],
  params: S.Object({
    metadata: S.Record(S.String()),
    payload: S.Json(),
  }),
  handler: async () => ({ ok: true }),
});

export const root = defineGroup({
  name: "example",
  scope: ["cli", "mcp", "sdk"],
  children: [lint, inspect] as const,
});
`,
    "utf8"
  );

  run("npm", ["install", "--ignore-scripts", "--install-strategy=nested"], {
    cwd: producerDir
  });
  run(path.join(repoRoot, "node_modules", ".bin", "tsc"), ["-p", "tsconfig.json"], {
    cwd: producerDir
  });
  const producerDeclaration = readFileSync(path.join(producerDir, "dist", "index.d.ts"), "utf8");
  if (!producerDeclaration.includes("files: number")) {
    throw new Error("Expected producer declaration to preserve the command result type.");
  }
  if (producerDeclaration.includes("toolcraft-schema")) {
    throw new Error(
      `Expected producer declaration to reference schema types through Toolcraft.\n${producerDeclaration}`
    );
  }
  const producerTarball = pack(producerDir);

  writeJson(path.join(consumerDir, "package.json"), {
    name: "toolcraft-sdk-types-consumer",
    private: true,
    type: "module",
    dependencies: {
      toolcraft: `file:${toolcraftTarball}`,
      "toolcraft-sdk-types-producer": `file:${producerTarball}`
    }
  });
  writeJson(path.join(consumerDir, "tsconfig.json"), {
    compilerOptions: {
      strict: true,
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      noEmit: true,
      typeRoots: [path.join(repoRoot, "node_modules", "@types")]
    },
    include: ["consumer.ts"]
  });
  writeFileSync(
    path.join(consumerDir, "consumer.ts"),
    `import { createSDK } from "toolcraft/sdk";
import { root } from "toolcraft-sdk-types-producer";

const sdk = createSDK(root);
// @ts-expect-error root must be a string
sdk.lint({ root: 42 });
const result = await sdk.lint({ root: "." });
const files: number = result.files;
void files;
`,
    "utf8"
  );

  run("npm", ["install", "--ignore-scripts", "--install-strategy=nested"], {
    cwd: consumerDir
  });
  for (const exactOptionalPropertyTypes of ["false", "true"]) {
    run(
      path.join(repoRoot, "node_modules", ".bin", "tsc"),
      ["-p", "tsconfig.json", "--exactOptionalPropertyTypes", exactOptionalPropertyTypes],
      { cwd: consumerDir }
    );
  }

  writeJson(path.join(consumerDir, "tsconfig.declaration.json"), {
    compilerOptions: {
      strict: false,
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      declaration: true,
      emitDeclarationOnly: true,
      outDir: "declaration-dist",
      typeRoots: [path.join(repoRoot, "node_modules", "@types")]
    },
    include: ["consumer-declaration.ts"]
  });
  writeFileSync(
    path.join(consumerDir, "consumer-declaration.ts"),
    `import { createSDK } from "toolcraft/sdk";
import { root } from "toolcraft-sdk-types-producer";

const sdk = createSDK(root);
export const result = sdk.lint({ root: "." });
`,
    "utf8"
  );
  run(
    path.join(repoRoot, "node_modules", ".bin", "tsc"),
    ["-p", "tsconfig.declaration.json"],
    { cwd: consumerDir }
  );
  const consumerDeclaration = readFileSync(
    path.join(consumerDir, "declaration-dist", "consumer-declaration.d.ts"),
    "utf8"
  );
  if (!consumerDeclaration.includes("files: number")) {
    throw new Error(
      `Expected consumer declaration to preserve the handler result type.\n${consumerDeclaration}`
    );
  }
  if (consumerDeclaration.includes("HumanInLoopPending")) {
    throw new Error("Command without human-in-loop mode inferred HumanInLoopPending.");
  }

  console.log("toolcraft published SDK type smoke passed.");
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}
