const textTags: Readonly<Record<number, string>> = {
  270: "exif:imagedescription",
  271: "exif:make",
  272: "exif:model",
  315: "exif:artist"
};

/** Read IFD0 ASCII properties from the retained TIFF profile. */
export function readExifTextProperties(profile: Uint8Array): Record<string, string> {
  const properties: Record<string, string> = {};
  if (profile.length < 8) return properties;
  const little = profile[0] === 73 && profile[1] === 73;
  if (!little && !(profile[0] === 77 && profile[1] === 77)) return properties;
  const view = new DataView(profile.buffer, profile.byteOffset, profile.byteLength);
  if (view.getUint16(2, little) !== 42) return properties;
  const ifd = view.getUint32(4, little);
  if (ifd < 8 || ifd + 2 > profile.length) return properties;
  const count = view.getUint16(ifd, little);
  for (let index = 0; index < count; index++) {
    const entry = ifd + 2 + index * 12;
    if (entry + 12 > profile.length) break;
    const key = textTags[view.getUint16(entry, little)];
    if (key === undefined || view.getUint16(entry + 2, little) !== 2) continue;
    const length = view.getUint32(entry + 4, little);
    const offset = length <= 4 ? entry + 8 : view.getUint32(entry + 8, little);
    if (length === 0 || offset + length > profile.length) continue;
    const bytes = profile.subarray(offset, offset + length);
    const nul = bytes.indexOf(0);
    properties[key] = new TextDecoder().decode(nul < 0 ? bytes : bytes.subarray(0, nul));
  }
  return properties;
}
