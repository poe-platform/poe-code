export interface AgentDefinition {
  id: string;
  name: string;
  label: string;
  summary: string;
  aliases?: string[];
  /** Binary name for CLI agents. Optional for GUI-only apps like Claude Desktop. */
  binaryName?: string;
  configPath: string;
  branding: {
    colors: {
      dark: string;
      light: string;
    };
  };
}
