#!/usr/bin/env tsx
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import fg from "fast-glob";
import matter from "gray-matter";
import {
  supportedAgents,
  getAgentConfig,
  resolveSkillDir
} from "../packages/agent-skill-config/src/index.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

async function main() {
  const templateFiles = await fg("**/SKILL_*.md", {
    cwd: ROOT,
    absolute: true,
    ignore: ["**/dist/**", "**/node_modules/**"]
  });

  const skills: Array<{ name: string; content: string }> = [];

  for (const templatePath of templateFiles) {
    const content = readFileSync(templatePath, "utf8");
    const { data } = matter(content);
    if (!data.name) continue;
    skills.push({ name: data.name as string, content });
  }

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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
