import { renderTemplate } from "toolcraft-design";

import { SCRIPT } from "./script.js";
import { CSS } from "./styles.js";
import { TEMPLATE } from "./template.js";

interface SurfaceView {
  name: string;
  description: string;
  example: string;
}

interface ParamView {
  name: string;
  type: string;
  requirement: string;
  description: string;
}

interface SecretView {
  name: string;
  description: string;
}

interface CommandView {
  pathPrefix: string;
  name: string;
  description: string;
  badges: string[];
  params: ParamView[];
  secrets: SecretView[];
  example: string;
}

interface GroupView {
  name: string;
  description: string;
  commands: CommandView[];
}

export interface LandingPageView {
  title: string;
  description: string;
  name: string;
  headline: string;
  tagline: string;
  accent: string;
  install?: string;
  version?: string;
  repoUrl?: string;
  surfaceCount: number;
  commandCount: number;
  groupCount: number;
  surfaces: SurfaceView[];
  groups: GroupView[];
  quickstart: string;
  includeJs: boolean;
}

export function renderLandingPage(page: LandingPageView): string {
  const groups = page.groups.map((group) => ({
    ...group,
    commands: group.commands.map((command) => ({
      ...command,
      hasParams: command.params.length > 0,
      hasSecrets: command.secrets.length > 0
    }))
  }));

  const styles = renderTemplate(CSS, { accent: page.accent });
  return renderTemplate(TEMPLATE, { ...page, groups, styles, script: SCRIPT });
}
