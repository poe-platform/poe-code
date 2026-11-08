export const tiffTextProperties: Readonly<Record<number, string>> = {
  270: "comment",
  272: "tiff:model",
  315: "tiff:artist",
  33432: "tiff:copyright"
};

export const tiffPhotometricNames: Readonly<Record<number, string>> = {
  0: "min-is-white", 1: "min-is-black", 2: "RGB", 3: "palette",
  4: "mask", 5: "separated", 6: "YCbCr", 8: "CIELAB", 9: "ICCLAB", 10: "ITULAB",
  32844: "LOGL", 32845: "LOGLUV"
};
