/// <reference types="node" />
export declare function getColumns(output: NodeJS.WritableStream): number;
export declare function getRows(output: NodeJS.WritableStream): number;
export declare function wrapTextWithPrefix(output: NodeJS.WritableStream, text: string, prefix: string, startPrefix?: string): string;
export declare function wrapFrame(output: NodeJS.WritableStream, frame: string): string;
