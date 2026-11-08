export declare const SPINNER_FRAMES: readonly ["◒", "◐", "◓", "◑"];
export interface SpinnerFrameOptions {
    frame?: number;
    message: string;
    timer?: string;
}
export declare function renderSpinnerFrame(options: SpinnerFrameOptions): string;
export interface SpinnerStoppedOptions {
    message: string;
    code?: number;
    timer?: string;
    subtext?: string;
}
export declare function renderSpinnerStopped(options: SpinnerStoppedOptions): string;
