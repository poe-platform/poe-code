export interface ThemeConfig {
  brand: string;
  label: string;
}
export declare function configureTheme(patch: {brand?: string; label?: string}): void;
export declare function getThemeConfig(): ThemeConfig;
export declare function getThemeRevision(): number;
export declare function isThemeBrandConfigured(): boolean;
export declare function resetTheme(): void;
