#!/usr/bin/env tsx
import { readFileSync, writeFileSync, existsSync } from "node:fs";
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

  const updated: string[] = [];

  for (const agent of supportedAgents) {
    const config = getAgentConfig(agent);
    if (!config) continue;

    for (const scope of ["global", "local"] as const) {
      const skillDir = resolveSkillDir(config, scope, process.cwd());

      for (const skill of skills) {
        const skillFilePath = join(skillDir, skill.name, "SKILL.md");
        if (!existsSync(skillFilePath)) continue;

        writeFileSync(skillFilePath, skill.content);
        updated.push(skillFilePath);
      }
    }
  }

  if (updated.length === 0) {
    console.log("No installed skills found to update.");
  } else {
    console.log(`Updated ${updated.length} skill(s):`);
    for (const file of updated) {
      console.log(`  ${file}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
