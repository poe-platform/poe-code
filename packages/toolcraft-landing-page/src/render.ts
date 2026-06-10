import { renderTemplate } from "toolcraft-design";

import { highlight } from "./highlight.js";
import { SCRIPT } from "./script.js";
import { CSS } from "./styles.js";
import { TEMPLATE } from "./template.js";

interface SurfaceView {
  name: string;
  description: string;
  example: string;
}

interface UseCaseView {
  title: string;
  description: string;
}

interface ExampleSurfaceView {
  name: string;
  code: string;
}

interface ExampleView {
  source: string;
  surfaces: ExampleSurfaceView[];
}

interface FeatureView {
  name: string;
  description: string;
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
  useCaseCount: number;
  surfaces: SurfaceView[];
  useCases: UseCaseView[];
  example: ExampleView;
  features: FeatureView[];
  quickstart: string;
  includeJs: boolean;
}

export function renderLandingPage(page: LandingPageView): string {
  const styles = renderTemplate(CSS, { accent: page.accent });
  const view = {
    ...page,
    installHtml: page.install === undefined ? undefined : highlight(page.install),
    surfaces: page.surfaces.map((surface) => ({
      ...surface,
      exampleHtml: highlight(surface.example)
    })),
    exampleSourceHtml: highlight(page.example.source),
    example: {
      ...page.example,
      surfaces: page.example.surfaces.map((surface) => ({
        ...surface,
        codeHtml: highlight(surface.code)
      }))
    },
    quickstartHtml: highlight(page.quickstart),
    styles,
    script: SCRIPT
  };
  return renderTemplate(TEMPLATE, view);
}
