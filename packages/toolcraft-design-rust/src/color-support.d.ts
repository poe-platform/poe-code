export interface ColorSupportEnv {
  NO_COLOR?: string;
  FORCE_COLOR?: string;
  TERM?: string;
}
export interface ColorSupportStream {
  isTTY?: boolean;
}
export declare function supportsColor(env?: ColorSupportEnv, stream?: ColorSupportStream): boolean;
