import { isAscii } from 'node:buffer';
export const answer = () => isAscii(new Uint8Array([52,50])) ? 42 : 0;
