import {
  createLogger,
  light,
  renderTable,
  stripAnsi,
  withOutputFormat,
  type ThemePalette
} from "toolcraft-design";
import type { RenderPrimitives } from "../index.js";

const captureWidth = 80;

function withoutColors(theme: ThemePalette): ThemePalette {
  return {
    header: (text) => stripAnsi(theme.header(text)),
    divider: (text) => stripAnsi(theme.divider(text)),
    prompt: (text) => stripAnsi(theme.prompt(text)),
    number: (text) => stripAnsi(theme.number(text)),
    intro: (text) => stripAnsi(theme.intro(text)),
    resolvedSymbol: stripAnsi(theme.resolvedSymbol),
    errorSymbol: stripAnsi(theme.errorSymbol),
    accent: (text) => stripAnsi(theme.accent(text)),
    muted: (text) => stripAnsi(theme.muted(text)),
    success: (text) => stripAnsi(theme.success(text)),
    warning: (text) => stripAnsi(theme.warning(text)),
    error: (text) => stripAnsi(theme.error(text)),
    info: (text) => stripAnsi(theme.info(text)),
    badge: (text) => stripAnsi(theme.badge(text)),
    styles: {
      accent: { ...theme.styles.accent },
      muted: { ...theme.styles.muted },
      success: { ...theme.styles.success },
      warning: { ...theme.styles.warning },
      error: { ...theme.styles.error },
      info: { ...theme.styles.info }
    }
  };
}

function createCaptureTheme(): ThemePalette {
  return {
    ...withoutColors(light),
    intro: (text) => ` Poe - ${text} `
  };
}

export interface RenderCapture {
  primitives: RenderPrimitives;
  output(): string;
}

export function createRenderCapture(outputFormat = "rich"): RenderCapture {
  const output: string[] = [];
  const captureTheme = createCaptureTheme();
  const emit = (message: string): void => {
    output.push(stripAnsi(message));
  };

  return {
    primitives: {
      logger: createLogger(emit),
      renderTable: (options) =>
        withOutputFormat("terminal", () =>
          stripAnsi(
            renderTable({
              ...options,
              theme: withoutColors(options.theme),
              maxWidth: captureWidth
            })
          )
        ),
      getTheme: () => captureTheme,
      note: (message, title) => emit(title === undefined ? message : `${title}\n${message}`),
      outputFormat
    },
    output: () => output.join("\n")
  };
}
