import fs from "node:fs";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { createFsFromVolume, Volume } from "memfs";
import tseslint from "typescript-eslint";
import receiptData from "../packages/safe-bash/integration-lint-audit/boundary-leaf-receipts.json" with { type: "json" };
import rootLinkOwnerData from "../packages/safe-bash/integration-lint-audit/root-claude-link-owner.json" with { type: "json" };
import { BOUNDARY_RECEIPTS, createLintInputGuard } from "./lint-input-guard.mjs";
import * as guardedInputs from "./lint-input-guard.mjs";
import {
  createLintSelection,
  lintRoot,
  main,
  parseLintArguments,
  printLintResult
} from "./lint-eslint.mjs";

export {
  BOUNDARY_RECEIPTS,
  createLintInputGuard,
  createLintSelection,
  guardedInputs,
  lintRoot,
  main,
  parseLintArguments,
  printLintResult
};

export const root = "/lint-owned";

export const digest = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");

export const boundaries = {
  heldSourceFiles: ["src/commands/xan/index.ts"],
  heldEvidenceDirectories: ["tests/held-capture"]
};

export function model(extra: Record<string, string> = {}, observation: "all" | "opens" = "all") {
  const packet = structuredClone(receiptData);
  const files: Record<string, string> = { ...extra };
  const inventory: { records: unknown[] } = { records: [] };
  for (const record of packet.records) {
    for (const owner of record.owners) {
      const text =
        record.path === "CLAUDE.md"
          ? JSON.stringify(rootLinkOwnerData)
          : owner.path.endsWith(".json")
            ? JSON.stringify({ owner: owner.path })
            : "export default 1;";
      files[owner.path] = text;
      owner.bytes = Buffer.byteLength(text);
      owner.sha256 = digest(text);
    }
    if (record.inventoryRecord) {
      inventory.records.push({
        id: record.inventoryRecord,
        owners: record.owners.map(({ path, bytes, sha256 }) => ({
          path: path.slice("packages/safe-bash/".length),
          bytes,
          sha256
        })),
        symlinks: [
          { path: record.path.slice("packages/safe-bash/".length), target: record.target }
        ],
        members: [record.companion]
      });
    }
  }
  const inventoryText = JSON.stringify(inventory);
  packet.inventory.bytes = Buffer.byteLength(inventoryText);
  packet.inventory.sha256 = digest(inventoryText);
  files[packet.inventory.path] = inventoryText;
  const receiptText = JSON.stringify(packet);
  files[BOUNDARY_RECEIPTS.path] = receiptText;
  const binding = {
    path: BOUNDARY_RECEIPTS.path,
    bytes: Buffer.byteLength(receiptText),
    sha256: digest(receiptText)
  };
  const volume = Volume.fromJSON(
    Object.fromEntries(Object.entries(files).map(([path, text]) => [root + "/" + path, text]))
  );
  const symlinkSizes = new Map<string, number>();
  const symlinkSync = volume.symlinkSync.bind(volume);
  volume.symlinkSync = (...args) => {
    const result = symlinkSync(...args);
    symlinkSizes.set(
      String(args[1]),
      Buffer.isBuffer(args[0]) ? args[0].length : Buffer.byteLength(String(args[0]))
    );
    return result;
  };
  for (const record of packet.records) {
    volume.mkdirSync(dirname(root + "/" + record.path), { recursive: true });
    if (record.kind === "symlink") volume.symlinkSync(record.target!, root + "/" + record.path);
    else volume.writeFileSync(root + "/" + record.path, "receipt leaf must not be read");
  }
  const memory = createFsFromVolume(volume);
  const operations: { method: string; path: string }[] = [];
  const fileSystem = { ...memory, constants: fs.constants };
  for (const method of [
    "lstatSync",
    "realpathSync",
    "readdirSync",
    "readlinkSync",
    "openSync"
  ] as const) {
    const original = memory[method].bind(memory) as (...args: any[]) => any;
    (fileSystem as any)[method] = (...args: any[]) => {
      const path = String(args[0]);
      if (observation === "all" || method === "openSync") operations.push({ method, path });
      const result = original(...args);
      if (method === "lstatSync" && result.isSymbolicLink() && symlinkSizes.has(String(args[0])))
        result.size = symlinkSizes.get(String(args[0]));
      return result;
    };
  }
  const config = [
    {
      ignores: packet.records
        .filter((record) => record.selection === "ignored")
        .map((record) => record.path)
    },
    {
      files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
      rules: { "no-undef": "error", "no-unused-vars": "warn" }
    },
    {
      files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
      languageOptions: { parser: tseslint.parser },
      rules: { "no-undef": "error" }
    }
  ];
  return {
    packet,
    binding,
    volume,
    memory,
    fileSystem,
    operations,
    config,
    guard: createLintInputGuard({ root, boundaries, fileSystem })
  };
}

export function receiptPayloads(state: ReturnType<typeof model>) {
  const leaves = new Set(state.packet.records.map((record) => root + "/" + record.path));
  return state.operations.filter(
    (operation) => operation.method === "openSync" && leaves.has(operation.path)
  );
}

export function bootstrapModel(observation: "all" | "opens" = "all") {
  const state = model(
    {
      "package.json": "{}",
      "eslint.config.js": "export default [];",
      "src/ordinary.js": "export {};"
    },
    observation
  );
  const policy = {
    version: 1,
    ...boundaries,
    heldEvidenceDirectories: ["tests/owned/held-capture"],
    fixtureDirectories: []
  };
  const text = JSON.stringify(policy);
  const binding = {
    path: "packages/safe-bash/integration-boundaries.json",
    bytes: Buffer.byteLength(text),
    sha256: digest(text)
  };
  state.volume.writeFileSync(root + "/" + binding.path, text);
  const calls: string[] = [];
  const options = {
    root,
    fileSystem: state.fileSystem,
    boundaryBinding: binding,
    receiptBinding: state.binding,
    buildConfig(_inputs: unknown, fileSystem?: unknown) {
      calls.push(fileSystem ? "final-config" : "selection-config");
      return state.config;
    },
    loadBoundaries(_root: string, fileSystem: any) {
      calls.push("boundary-owners");
      return JSON.parse(fileSystem.readFileSync(root + "/" + binding.path));
    },
    lintExclusions() {
      calls.push("inventory-provenance");
      return { files: [], directories: [] };
    }
  };
  return { ...state, policy, policyBinding: binding, calls, options };
}
