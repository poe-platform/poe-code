export declare function intro(title: string): void;
export declare function introPlain(title: string): void;
export declare function outro(message: string): void;
export declare function cancel(msg?: string): void;
export interface LogMessageOptions {
  symbol?: string;
  secondarySymbol?: string;
  spacing?: number;
  withGuide?: boolean;
}
export declare function message(msg: string, options?: LogMessageOptions): void;
export declare function info(msg: string): void;
export declare function success(msg: string): void;
export declare function warn(msg: string): void;
export declare function error(msg: string): void;
export declare const log: {info: typeof info; success: typeof success; message: typeof message; warn: typeof warn; error: typeof error;};
