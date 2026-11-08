interface CliWriter {
    write(chunk: string | Uint8Array): boolean;
}
interface CliOutput {
    stderr: CliWriter;
}
export declare function main(args?: string[], output?: CliOutput): Promise<number>;
export {};
