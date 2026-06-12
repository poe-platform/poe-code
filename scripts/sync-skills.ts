#!/usr/bin/env tsx
import { readFileSync, writeFileSync, existsSync, mkdirSync, lstatSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fg from "fast-glob";
import matter from "gray-matter";
import {
  supportedAgents,
  getAgentConfig,
  resolveSkillDir
} from "../packages/agent-skill-config/src/index.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function loadSkills(templatePaths: readonly string[]) {
  return templatePaths.flatMap((templatePath) => {
    const content = readFileSync(join(ROOT, templatePath), "utf8");
    const { data } = matter(content);
    return data.name ? [{ name: data.name as string, content }] : [];
  });
}

type PathStatFs = Pick<typeof import("node:fs"), "lstatSync">;

export function assertSafeSkillPath(
  targetPath: string,
  boundaryPath: string,
  fs: PathStatFs = { lstatSync }
): void {
  const parentOfBoundary = dirname(boundaryPath);
  let currentPath = targetPath;
  while (currentPath !== parentOfBoundary) {
    try {
      if (fs.lstatSync(currentPath).isSymbolicLink()) {
        throw new Error(`Refusing skill sync through symbolic link: ${currentPath}`);
      }
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
    }
    currentPath = dirname(currentPath);
  }
}

async function main() {
  const templateFiles = await fg("**/SKILL_*.md", {
    cwd: ROOT,
    absolute: false,
    ignore: ["**/dist/**", "**/node_modules/**"]
  });
  const skills = loadSkills(templateFiles);

  const changed: string[] = [];
  let unchanged = 0;

  const scopes =
    process.env.SYNC_SKILLS_SCOPE === "global"
      ? (["global"] as const)
      : (["global", "local"] as const);

  for (const agent of supportedAgents) {
    const config = getAgentConfig(agent);
    if (!config) continue;

    for (const scope of scopes) {
      const skillDir = resolveSkillDir(config, scope, process.cwd());
      const shouldInstallMissing = scope === "global";

      if (!shouldInstallMissing && !existsSync(skillDir)) {
        continue;
      }

      for (const skill of skills) {
        const skillFilePath = join(skillDir, skill.name, "SKILL.md");
        assertSafeSkillPath(skillFilePath, scope === "global" ? homedir() : process.cwd());
        if (!existsSync(skillFilePath)) {
          if (!shouldInstallMissing) continue;

          mkdirSync(join(skillDir, skill.name), { recursive: true });
          writeFileSync(skillFilePath, skill.content);
          changed.push(skillFilePath);
          continue;
        }

        const current = readFileSync(skillFilePath, "utf8");
        if (current === skill.content) {
          unchanged++;
          continue;
        }

        writeFileSync(skillFilePath, skill.content);
        changed.push(skillFilePath);
      }
    }
  }

  if (changed.length === 0 && unchanged === 0) {
    console.log("No installed skills found to update.");
  } else if (changed.length === 0) {
    console.log(`All ${unchanged} installed skill(s) already up to date.`);
  } else {
    console.log(`Updated ${changed.length} skill(s) (${unchanged} already up to date):`);
    for (const file of changed) {
      console.log(`  ${file}`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
