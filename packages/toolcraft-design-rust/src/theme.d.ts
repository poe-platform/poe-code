export interface Brand {
  name: string;
  primary: string;
}
export declare const brands: Record<string, Brand>;
export declare const brand: string;
export type ThemeName = "dark" | "light";
export interface ThemeCellStyle {
  fg?: string;
  bold?: boolean;
  dim?: boolean;
  underline?: boolean;
}
export interface ThemeCellStyles {
  accent: ThemeCellStyle;
  muted: ThemeCellStyle;
  success: ThemeCellStyle;
  warning: ThemeCellStyle;
  error: ThemeCellStyle;
  info: ThemeCellStyle;
}
export interface ThemePalette {
  header: (text: string) => string;
  divider: (text: string) => string;
  prompt: (text: string) => string;
  number: (text: string) => string;
  intro: (text: string) => string;
  resolvedSymbol: string;
  errorSymbol: string;
  accent: (text: string) => string;
  muted: (text: string) => string;
  success: (text: string) => string;
  warning: (text: string) => string;
  error: (text: string) => string;
  info: (text: string) => string;
  badge: (text: string) => string;
  styles: ThemeCellStyles;
}
export interface ThemeEnv {
  POE_CODE_THEME?: string;
  POE_THEME?: string;
  POE_BRAND?: string;
  APPLE_INTERFACE_STYLE?: string;
  VSCODE_COLOR_THEME_KIND?: string;
  COLORFGBG?: string;
}
export declare function createPalette(brand: Brand, mode: ThemeName): ThemePalette;
export declare const dark: ThemePalette, light: ThemePalette;
export declare function resolveThemeName(env?: ThemeEnv): ThemeName;
export declare function getTheme(env?: ThemeEnv): ThemePalette;
export declare function resetThemeCache(): void;
