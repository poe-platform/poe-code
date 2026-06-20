import { color } from "../../components/color.js";
import type { PromptStateName } from "./core.js";

function supportsUnicode(): boolean {
  if (!process.platform.startsWith("win")) {
    return process.env.TERM !== "linux";
  }

  return Boolean(
    process.env.CI ||
    process.env.WT_SESSION ||
    process.env.TERMINUS_SUBLIME ||
    process.env.ConEmuTask === "{cmd::Cmder}" ||
    process.env.TERM_PROGRAM === "Terminus-Sublime" ||
    process.env.TERM_PROGRAM === "vscode" ||
    process.env.TERM === "xterm-256color" ||
    process.env.TERM === "alacritty" ||
    process.env.TERMINAL_EMULATOR === "JetBrains-JediTerm"
  );
}

export const UNICODE = supportsUnicode();

function glyph(unicode: string, ascii: string): string {
  return UNICODE ? unicode : ascii;
}

export const GLYPHS = {
  stepActive: glyph("◆", "*"),
  stepCancel: glyph("■", "x"),
  stepError: glyph("▲", "x"),
  stepSubmit: glyph("◇", "o"),
  barStart: glyph("┌", "T"),
  bar: glyph("│", "|"),
  barEnd: glyph("└", "-"),
  radioActive: glyph("●", ">"),
  radioInactive: glyph("○", " "),
  checkboxActive: "[ ]",
  checkboxSelected: "[x]",
  checkboxInactive: "[ ]",
  passwordMask: glyph("•", "*"),
  ellipsis: "..."
} as const;

export function symbol(state: PromptStateName): string {
  if (state === "cancel") return color.red(GLYPHS.stepCancel);
  if (state === "error") return color.yellow(GLYPHS.stepError);
  if (state === "submit") return color.green(GLYPHS.stepSubmit);
  return color.cyan(GLYPHS.stepActive);
}

export function symbolBar(state: PromptStateName): string {
  if (state === "cancel") return color.red(GLYPHS.bar);
  if (state === "error") return color.yellow(GLYPHS.bar);
  if (state === "submit") return color.green(GLYPHS.bar);
  return color.cyan(GLYPHS.bar);
}
