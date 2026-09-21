export type Color = {
    type: "ansi4";
    index: number;
} | {
    type: "ansi8";
    index: number;
} | {
    type: "rgb";
    r: number;
    g: number;
    b: number;
};
export type StyledRun = {
    text: string;
    fg: Color | null;
    bg: Color | null;
    bold: boolean;
    italic: boolean;
    underline: boolean;
    strikethrough: boolean;
    dim: boolean;
    inverse: boolean;
    conceal: boolean;
};
export declare function parseAnsi(input: string): StyledRun[];

export interface SvgOptions {
    padding?: number;
    window?: boolean;
}
export declare function renderSvg(runs: StyledRun[], options?: SvgOptions): string;
export declare const JETBRAINS_MONO_BASE64: string;
export declare const JETBRAINS_MONO_FONT_FILES: readonly [string, string, string, string];
export declare const JETBRAINS_MONO_TTF_PATH: string;
export declare const FONT_FACE_CSS: string;
export declare function renderPng(svg: string): Buffer;

export interface TerminalPngOptions {padding?:number;window?:boolean;output?:string;}
export declare function renderTerminalPng(ansiText:string,options?:TerminalPngOptions):Promise<Buffer>;
