export interface FrameWriter {
    open(): void;
    close(): void;
    writeFrame(ansi: string): void;
}
export declare function createFrameWriter(stream: {
    write(value: string): boolean;
}, options?: {
    mouse?: boolean;
}): FrameWriter;
