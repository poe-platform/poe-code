// Archived Node fetch fixtures use the supported streaming upload option.
export {};

declare global {
  interface RequestInit {
    duplex?: "half";
  }
}
