export type HelpTokenRole = "command" | "argument" | "option" | "literal" | "dim";
export interface HelpToken { text: string; role: HelpTokenRole; }
export interface CommandInfo { name: string; nameTokens?: HelpToken[]; description: string; depth?: number; }
export interface OptionInfo { flags: string; flagTokens?: HelpToken[]; description: string; }
export interface FormatColumnsOptions {
  rows: Array<{ left: string; right: string }>;
  totalWidth?: number;
  minLeftWidth?: number;
  maxLeftWidth?: number;
  gap?: number;
  indent?: number;
}
export declare function formatColumns(options: FormatColumnsOptions): string;
export declare function styleHelpToken(token: HelpToken): string;
export declare function joinHelpTokens(tokens: HelpToken[]): string;
export declare function renderHelpTokens(tokens: HelpToken[]): string;
export declare function formatCommand(name: string, description: string): string;
export declare function formatUsage(command: string, args?: string): string;
export declare function formatOption(flags: string, description: string): string;
export declare function formatCommandList(commands: CommandInfo[]): string;
export declare function formatOptionList(options: OptionInfo[]): string;
export declare const helpFormatter: {
  readonly formatColumns: typeof formatColumns;
  readonly formatCommand: typeof formatCommand;
  readonly formatUsage: typeof formatUsage;
  readonly formatOption: typeof formatOption;
  readonly formatCommandList: typeof formatCommandList;
  readonly formatOptionList: typeof formatOptionList;
  readonly styleHelpToken: typeof styleHelpToken;
  readonly joinHelpTokens: typeof joinHelpTokens;
  readonly renderHelpTokens: typeof renderHelpTokens;
};
