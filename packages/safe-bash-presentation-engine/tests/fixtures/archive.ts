export function storedArchive(
  members: readonly { name: string; bytes: Uint8Array; mode?: number }[]
): Uint8Array {
  const names = members.map((member) => new TextEncoder().encode(member.name));
  const localSize = members.reduce(
    (size, member, index) => size + 30 + names[index]!.length + member.bytes.length,
    0
  );
  const centralSize = names.reduce((size, name) => size + 46 + name.length, 0);
  const bytes = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(bytes.buffer);
  let local = 0;
  let central = localSize;
  members.forEach((member, index) => {
    const name = names[index]!;
    let checksum = 0xffffffff;
    for (const byte of member.bytes) {
      checksum ^= byte;
      for (let bit = 0; bit < 8; bit++) {
        checksum = (checksum >>> 1) ^ ((checksum & 1) === 0 ? 0 : 0xedb88320);
      }
    }
    checksum = (checksum ^ 0xffffffff) >>> 0;
    view.setUint32(local, 0x04034b50, true);
    view.setUint16(local + 4, 20, true);
    view.setUint16(local + 6, 0x800, true);
    view.setUint32(local + 14, checksum, true);
    view.setUint32(local + 18, member.bytes.length, true);
    view.setUint32(local + 22, member.bytes.length, true);
    view.setUint16(local + 26, name.length, true);
    bytes.set(name, local + 30);
    bytes.set(member.bytes, local + 30 + name.length);
    view.setUint32(central, 0x02014b50, true);
    view.setUint16(central + 4, 0x0314, true);
    view.setUint16(central + 6, 20, true);
    view.setUint16(central + 8, 0x800, true);
    view.setUint32(central + 16, checksum, true);
    view.setUint32(central + 20, member.bytes.length, true);
    view.setUint32(central + 24, member.bytes.length, true);
    view.setUint16(central + 28, name.length, true);
    view.setUint32(central + 38, (member.mode ?? 0o100644) * 65536, true);
    view.setUint32(central + 42, local, true);
    bytes.set(name, central + 46);
    local += 30 + name.length + member.bytes.length;
    central += 46 + name.length;
  });
  view.setUint32(central, 0x06054b50, true);
  view.setUint16(central + 8, members.length, true);
  view.setUint16(central + 10, members.length, true);
  view.setUint32(central + 12, centralSize, true);
  view.setUint32(central + 16, localSize, true);
  return bytes;
}
