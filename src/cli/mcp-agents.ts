import chalk from "chalk";

export interface McpAgentProfile {
  name: string;
  supportsRichContent: boolean;
}

export const MCP_AGENT_PROFILES: Record<string, McpAgentProfile> = {
  "claude-code": {
    name: "Claude Code",
    supportsRichContent: true
  },
  codex: {
    name: "Codex CLI",
    supportsRichContent: true
  },
  cline: {
    name: "Cline",
    supportsRichContent: false
  },
  "roo-code": {
    name: "Roo Code",
    supportsRichContent: false
  },
  "gemini-cli": {
    name: "Gemini CLI",
    supportsRichContent: false
  },
  librechat: {
    name: "LibreChat",
    supportsRichContent: false
  },
  generic: {
    name: "Generic",
    supportsRichContent: false
  }
};

export const DEFAULT_AGENT = "generic";

export function getAgentProfile(name: string): McpAgentProfile | undefined {
  return MCP_AGENT_PROFILES[name];
}

export function formatAgentsList(): string {
  const lines: string[] = [];
  lines.push(chalk.magenta.bold("Available Agents"));
  lines.push("");

  for (const [key, profile] of Object.entries(MCP_AGENT_PROFILES)) {
    const supportLabel = profile.supportsRichContent
      ? chalk.green("rich content")
      : chalk.yellow("text-only");
    lines.push(`  ${chalk.cyan(key)} ${chalk.dim(`(${profile.name})`)} ${supportLabel}`);
  }

  return lines.join("\n");
}
