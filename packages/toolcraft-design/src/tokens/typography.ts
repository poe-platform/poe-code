import { color } from "../components/color.js";

export const typography = {
  bold: (text: string) => color.bold(text),
  dim: (text: string) => color.dim(text),
  italic: (text: string) => color.italic(text),
  underline: (text: string) => color.underline(text),
  strikethrough: (text: string) => color.strikethrough(text)
} as const;
