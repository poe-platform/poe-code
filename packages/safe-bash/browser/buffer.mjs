import { Buffer as PortableBuffer } from "buffer";

export const Buffer = globalThis.Buffer ?? PortableBuffer;
