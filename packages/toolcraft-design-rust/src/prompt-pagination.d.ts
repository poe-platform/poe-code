/// <reference types="node" />
export interface PaginationOptions<Option> {
    cursor: number;
    options: Option[];
    style: (option: Option, active: boolean) => string;
    output: NodeJS.WritableStream;
    maxItems?: number;
    columnPadding?: number;
    rowPadding?: number;
}
export declare function limitOptions<Option>(opts: PaginationOptions<Option>): string[];
