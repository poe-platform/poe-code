// Only the bootstrap's prototype access needs typing. The guarded compiler
// deliberately does not admit arbitrary npm declarations from node_modules.
declare module "buffer/index.js" {
  export const Buffer: { prototype: Uint8Array };
}
