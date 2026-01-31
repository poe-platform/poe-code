export interface AgentDefinition {
  id: string;
  name: string;
  label: string;
  summary: string;
  aliases?: string[];
  binaryName: string;
  configPath: string;
  branding: {
    colors: {
      dark: string;
      light: string;
    };
  };
}
