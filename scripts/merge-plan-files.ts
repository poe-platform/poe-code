#!/usr/bin/env tsx
import { readFileSync, writeFileSync, unlinkSync, renameSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import fg from "fast-glob";
import matter from "gray-matter";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PLANS_DIR = join(ROOT, "docs/plans");

type Action =
  | { kind: "merge"; pipelinePath: string; targetPath: string }
  | { kind: "rename"; from: string; to: string };

function plan(): Action[] {
  const planFiles = fg.sync("plan-*.md", { cwd: PLANS_DIR, absolute: true });
  return planFiles.map((pipelinePath): Action => {
    const dir = dirname(pipelinePath);
    const targetName = basename(pipelinePath).replace(/^plan-/, "");
    const targetPath = join(dir, targetName);
    if (existsSync(targetPath)) {
      return { kind: "merge", pipelinePath, targetPath };
    }
    return { kind: "rename", from: pipelinePath, to: targetPath };
  });
}

function merge(pipelinePath: string, targetPath: string) {
  const pipeline = matter(readFileSync(pipelinePath, "utf8"));
  const target = matter(readFileSync(targetPath, "utf8"));

  if (pipeline.data.kind !== "pipeline") {
    throw new Error(`expected kind: pipeline in ${pipelinePath}, got ${pipeline.data.kind}`);
  }

  const pipelineBody = pipeline.content.trim();
  const targetBody = target.content.trim();
  const mergedBody = [pipelineBody, targetBody].filter(Boolean).join("\n\n");

  const merged = matter.stringify(`\n${mergedBody}\n`, pipeline.data);
  writeFileSync(targetPath, merged);
  unlinkSync(pipelinePath);
}

function main() {
  const actions = plan();
  if (actions.length === 0) {
    console.log("No plan-*.md files to merge.");
    return;
  }

  for (const a of actions) {
    if (a.kind === "merge") {
      merge(a.pipelinePath, a.targetPath);
      console.log(`merged ${basename(a.pipelinePath)} → ${basename(a.targetPath)}`);
    } else {
      renameSync(a.from, a.to);
      console.log(`renamed ${basename(a.from)} → ${basename(a.to)}`);
    }
  }
}

main();
