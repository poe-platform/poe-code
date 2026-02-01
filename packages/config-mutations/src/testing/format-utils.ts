import type { ConfigObject } from "../types.js";
import { jsonFormat } from "../formats/json.js";
import { tomlFormat } from "../formats/toml.js";

export function parseToml(content: string): ConfigObject {
  return tomlFormat.parse(content);
}

export function serializeToml(obj: ConfigObject): string {
  return tomlFormat.serialize(obj);
}

export function parseJson(content: string): ConfigObject {
  return jsonFormat.parse(content);
}

export function serializeJson(obj: ConfigObject): string {
  return jsonFormat.serialize(obj);
}
