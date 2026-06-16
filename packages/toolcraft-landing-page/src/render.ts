import { renderTemplate } from "toolcraft-design";

import { highlight } from "./highlight.js";
import { SCRIPT } from "./script.js";
import { CSS } from "./styles.js";
import { TEMPLATE } from "./template.js";

const DEFAULT_ACCENT = "#2563eb";

interface UseCaseView {
  title: string;
  description: string;
  example: string;
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
  headlineHighlight?: string;
  tagline: string;
  accent: string;
  install?: string;
  version?: string;
  repoUrl?: string;
  docsUrl: string;
  useCases: UseCaseView[];
  example: ExampleView;
  features: FeatureView[];
  quickstart: string;
  includeJs: boolean;
}

function isAsciiHexDigit(value: string): boolean {
  const code = value.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 70) ||
    (code >= 97 && code <= 102)
  );
}

function isHexColor(value: string): boolean {
  if (!value.startsWith("#")) {
    return false;
  }
  if (![4, 5, 7, 9].includes(value.length)) {
    return false;
  }
  for (const char of value.slice(1)) {
    if (!isAsciiHexDigit(char)) {
      return false;
    }
  }
  return true;
}

function isNamedColor(value: string): boolean {
  if (value.length === 0) {
    return false;
  }
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (!((code >= 65 && code <= 90) || (code >= 97 && code <= 122))) {
      return false;
    }
  }
  return true;
}

function sanitizeAccent(value: string): string {
  const trimmed = value.trim();
  if (isHexColor(trimmed) || isNamedColor(trimmed)) {
    return trimmed;
  }
  return DEFAULT_ACCENT;
}

function hasUnsafeHrefCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 32 || code === 127) {
      return true;
    }
  }
  return false;
}

function schemeDelimiterIndex(value: string): number {
  const colon = value.indexOf(":");
  if (colon === -1) {
    return -1;
  }
  const slash = value.indexOf("/");
  const question = value.indexOf("?");
  const hash = value.indexOf("#");
  const precedingDelimiters = [slash, question, hash].filter((index) => index !== -1);
  if (precedingDelimiters.some((index) => index < colon)) {
    return -1;
  }
  return colon;
}

function safeHref(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || hasUnsafeHrefCharacter(trimmed)) {
    return undefined;
  }
  const delimiter = schemeDelimiterIndex(trimmed);
  if (delimiter === -1) {
    return trimmed;
  }
  const scheme = trimmed.slice(0, delimiter).toLowerCase();
  return scheme === "http" || scheme === "https" ? trimmed : undefined;
}

function stripFragment(value: string): string {
  const hash = value.indexOf("#");
  return hash === -1 ? value : value.slice(0, hash);
}

function docsHref(value: string): string {
  return stripFragment(safeHref(value) ?? "#docs");
}

function docsAnchorHref(baseHref: string, anchor: string): string {
  return baseHref === "#docs" ? baseHref : `${baseHref}#${anchor}`;
}

export function renderLandingPage(page: LandingPageView): string {
  const accent = sanitizeAccent(page.accent);
  const docsUrl = docsHref(page.docsUrl);
  const styles = renderTemplate(CSS, { accent });
  const view = {
    ...page,
    accent,
    repoUrl: safeHref(page.repoUrl),
    docsUrl,
    docsHelloWorldUrl: docsAnchorHref(docsUrl, "hello-world"),
    docsRuntimeUrl: docsAnchorHref(docsUrl, "one-binary-three-runtimes"),
    docsSecretsUrl: docsAnchorHref(docsUrl, "secrets"),
    docsMigrationUrl: docsAnchorHref(docsUrl, "migrating-from-a-folder-of-scripts"),
    copyInstall: page.includeJs && page.install !== undefined,
    installHtml: page.install === undefined ? undefined : highlight(page.install),
    useCases: page.useCases.map((useCase) => ({
      ...useCase,
      exampleHtml: highlight(useCase.example)
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
