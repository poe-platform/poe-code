#!/usr/bin/env tsx
import { readFileSync, writeFileSync, unlinkSync, renameSync, existsSync, lstatSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import fg from "fast-glob";
import matter from "gray-matter";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PLANS_DIR = join(ROOT, "docs/plans");

type Action =
  | { kind: "merge"; pipelinePath: string; targetPath: string }
  | { kind: "rename"; from: string; to: string };

interface MergePlanFs {
  existsSync(path: string): boolean;
  lstatSync(path: string): { isSymbolicLink(): boolean };
  readFileSync(path: string, encoding: BufferEncoding): string;
  writeFileSync(path: string, data: string): void;
  unlinkSync(path: string): void;
  renameSync(from: string, to: string): void;
}

const systemFs: MergePlanFs = {
  existsSync,
  lstatSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  renameSync
};

function rejectSymbolicLink(filePath: string, fs: Pick<MergePlanFs, "existsSync" | "lstatSync">): void {
  if (fs.existsSync(filePath) && fs.lstatSync(filePath).isSymbolicLink()) {
    throw new Error(`Refusing to merge plan through symbolic link: ${filePath}`);
  }
}

export function planMergeActions(planFiles: string[], fs: Pick<MergePlanFs, "existsSync" | "lstatSync"> = systemFs): Action[] {
  return planFiles.map((pipelinePath): Action => {
    rejectSymbolicLink(pipelinePath, fs);
    const dir = dirname(pipelinePath);
    const targetName = basename(pipelinePath).replace(/^plan-/, "");
    const targetPath = join(dir, targetName);
    if (fs.existsSync(targetPath)) {
      rejectSymbolicLink(targetPath, fs);
      return { kind: "merge", pipelinePath, targetPath };
    }
    return { kind: "rename", from: pipelinePath, to: targetPath };
  });
}

function merge(pipelinePath: string, targetPath: string, fs: MergePlanFs = systemFs) {
  rejectSymbolicLink(pipelinePath, fs);
  rejectSymbolicLink(targetPath, fs);
  const pipeline = matter(fs.readFileSync(pipelinePath, "utf8"));
  const target = matter(fs.readFileSync(targetPath, "utf8"));

  if (pipeline.data.kind !== "pipeline") {
    throw new Error(`expected kind: pipeline in ${pipelinePath}, got ${pipeline.data.kind}`);
  }

  const pipelineBody = pipeline.content.trim();
  const targetBody = target.content.trim();
  const mergedBody = [pipelineBody, targetBody].filter(Boolean).join("\n\n");

  const merged = matter.stringify(`\n${mergedBody}\n`, pipeline.data);
  fs.writeFileSync(targetPath, merged);
  fs.unlinkSync(pipelinePath);
}

export function mergePlanFiles(options: { planFiles: string[]; fs?: MergePlanFs }): Action[] {
  const fs = options.fs ?? systemFs;
  const actions = planMergeActions(options.planFiles, fs);
  for (const action of actions) {
    if (action.kind === "merge") {
      merge(action.pipelinePath, action.targetPath, fs);
    } else {
      rejectSymbolicLink(action.from, fs);
      rejectSymbolicLink(action.to, fs);
      fs.renameSync(action.from, action.to);
    }
  }
  return actions;
}

function main() {
  const planFiles = fg.sync("plan-*.md", { cwd: PLANS_DIR, absolute: true });
  const actions = mergePlanFiles({ planFiles });
  if (actions.length === 0) {
    console.log("No plan-*.md files to merge.");
    return;
  }

  for (const a of actions) {
    if (a.kind === "merge") {
      console.log(`merged ${basename(a.pipelinePath)} → ${basename(a.targetPath)}`);
    } else {
      console.log(`renamed ${basename(a.from)} → ${basename(a.to)}`);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
