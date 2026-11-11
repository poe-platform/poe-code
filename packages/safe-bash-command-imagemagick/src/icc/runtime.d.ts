interface IccRuntime {
    HEAPU8: Uint8Array;
    HEAPF64: Float64Array;
    _malloc(bytes: number): number;
    _free(pointer: number): void;
    _cmsOpenProfileFromMem(pointer: number, length: number): number;
    _cmsCloseProfile(profile: number): void;
    _cmsGetColorSpace(profile: number): number;
    _cmsFormatterForColorspaceOfProfile(profile: number, bytes: number, floating: number): number;
    _cmsCreateTransform(source: number, inputFormat: number, destination: number, outputFormat: number, intent: number, flags: number): number;
    _cmsDeleteTransform(transform: number): void;
    _cmsDoTransform(transform: number, input: number, output: number, count: number): void;
}
export default function createIccRuntime(): IccRuntime;
