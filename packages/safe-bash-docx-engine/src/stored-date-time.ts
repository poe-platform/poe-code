import { InvalidValueError } from "./archive.js";
import { validateDocxValue } from "./operation-schema.js";

export function parseStoredDateTime(raw: string, flavor: "w3cdtf" | "xsd"): Date {
  if (flavor === "xsd") {
    let start = 0, end = raw.length;
    while (start < end && " \t\r\n".includes(raw[start]!)) start++;
    while (end > start && " \t\r\n".includes(raw[end - 1]!)) end--;
    raw = raw.slice(start, end);
    if (raw.slice(0, 4) === "0000") throw new InvalidValueError("XML dateTime values require a nonzero native year.");
  }
  let wall: string, offset = 0;
  if (raw.endsWith("Z")) wall = raw.slice(0, -1);
  else {
    const zone = raw.slice(-6);
    if (!["+", "-"].includes(zone[0]!) || zone[3] !== ":" ||
      [...zone.slice(1)].some((char, index) => index !== 2 && !"0123456789".includes(char)))
      throw new InvalidValueError("Expected an explicit stored property timezone.");
    const hours = Number(zone.slice(1, 3)), minutes = Number(zone.slice(4));
    if (hours > 23 || minutes > 59 || flavor === "xsd" && hours * 60 + minutes > 840)
      throw new InvalidValueError("Expected a valid stored property timezone.");
    wall = raw.slice(0, -6);
    offset = (hours * 60 + minutes) * (zone[0] === "+" ? 1 : -1);
  }
  if (flavor === "w3cdtf" && wall.length === 16) wall += ":00";
  let nextDay = false;
  if (flavor === "xsd" && wall.slice(11, 13) === "24") {
    const fraction = wall.slice(19);
    if (wall.slice(13, 19) !== ":00:00" || fraction &&
      (fraction[0] !== "." || fraction.length === 1 || [...fraction.slice(1)].some(char => char !== "0")))
      throw new InvalidValueError("Expected zero fields after stored midnight24.");
    wall = wall.slice(0, 11) + "00" + wall.slice(13);
    nextDay = true;
  }
  if (!validateDocxValue("UTC instant", wall + "Z")) throw new InvalidValueError("Expected a valid stored calendar instant.");
  return new Date(new Date(wall + "Z").getTime() + (nextDay ? 86400000 : 0) - offset * 60000);
}
