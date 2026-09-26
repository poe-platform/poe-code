import type { Runtime } from "../runtime.js";
import type { TableValue } from "../table/index.js";
import { match } from "../columns.js";
import { numericField } from "../csv.js";
import { Decimal } from "../types/decimal.js";
import { CsvkitBlocked, CsvkitDiagnostic } from "../errors.js";
import { decodeJson, type JsonInput } from "../json-input.js";
import type { JsonValue } from "../operations/json-table.js";

/** Source schema deliberately ignores the type column and omits falsey properties. */
export class GeoJsonGenerator {
  private readonly lat: number;
  private readonly lon: number;
  private readonly type: number | null;
  private readonly geometry: number | null;
  private readonly id: number | null;

  constructor(private readonly runtime: Runtime, private readonly headers: readonly string[], tuple: boolean) {
    const o = runtime.options;
    const column = (name: string): number => match(headers, String(o[name]), Number(Boolean(o.zero_based)), tuple);
    this.lat = column("lat"); this.lon = column("lon");
    this.type = o.type ? column("type") : null;
    this.geometry = o.geometry ? column("geometry") : null;
    this.id = o.key ? column("key") : null;
  }

  private serialize(value: TableValue): JsonValue {
    if (value === null || typeof value !== "object") return value;
    if (value.kind === "timedelta") throw new CsvkitBlocked("GeoJSON timedelta TypeError repr profile");
    return value.kind === "datetime" ? value.value.replace(" ", "T") : value.value;
  }

  private truthy(value: TableValue): boolean {
    if (value === null) return false;
    if (typeof value !== "object") return Boolean(value);
    if (value.kind === "decimal") return Decimal.parse(value.value).special !== undefined || Decimal.parse(value.value).coefficient !== 0n;
    return value.kind !== "timedelta" || value.microseconds !== 0n;
  }

  private float(value: TableValue | undefined): number {
    if (value === undefined) throw new CsvkitDiagnostic("IndexError: list index out of range");
    if (value === null) throw new CsvkitDiagnostic("TypeError: float() argument must be a string or a real number, not 'NoneType'");
    if (typeof value === "boolean") return Number(value);
    if (typeof value === "object" && value.kind !== "decimal") throw new CsvkitBlocked("GeoJSON nonnumeric coordinate TypeError profile");
    const text = typeof value === "object" ? value.value : value;
    if (typeof value === "object") return value.value.includes("NaN") ? NaN : Number(value.value);
    return numericField(text);
  }

  private decoded(value: JsonInput): JsonValue {
    this.runtime.step();
    if (value === null || typeof value !== "object") return value;
    if (value instanceof Map) return new Map([...value].map(([key, child]) => [key, this.decoded(child)]));
    if (Array.isArray(value)) return value.map(child => this.decoded(child));
    const token = (value as { token: string }).token;
    if (token.includes(".") || token.toLowerCase().includes("e") || token.includes("Infinity") || token === "NaN") return Number(token);
    return { token: BigInt(token).toString() };
  }

  feature(row: readonly TableValue[]): Map<string, JsonValue> {
    const properties = new Map<string, JsonValue>();
    const feature = new Map<string, JsonValue>([["type", "Feature"], ["properties", properties]]);
    this.runtime.retain(128 + row.length * 64);
    for (const [index, value] of row.entries()) {
      this.runtime.step();
      if (value === null || [this.type, this.lat, this.lon, this.geometry].includes(index)) continue;
      if (index === this.id) feature.set("id", this.serialize(value));
      else if (this.truthy(value)) {
        if (index >= this.headers.length) throw new CsvkitDiagnostic("IndexError: list index out of range");
        properties.set(this.headers[index]!, this.serialize(value));
      }
    }
    let geometry: JsonValue = null;
    if (this.geometry !== null) {
      const value = row[this.geometry];
      if (value === undefined) throw new CsvkitDiagnostic("IndexError: list index out of range");
      if (typeof value !== "string") {
        const type = value === null ? "NoneType" : typeof value === "boolean" ? "bool" :
          value.kind === "decimal" ? "Decimal" : value.kind === "timedelta" ? "timedelta" : value.kind;
        throw new CsvkitDiagnostic(`TypeError: the JSON object must be str, bytes or bytearray, not ${type}`);
      }
      geometry = this.decoded(decodeJson(value, this.runtime));
    } else {
      try {
        const lon = this.float(row[this.lon]); const lat = this.float(row[this.lat]);
        if (lon !== 0 && lat !== 0) geometry = new Map<string, JsonValue>([["type", "Point"], ["coordinates", [lon, lat]]]);
      } catch (error) {
        if (!(error instanceof CsvkitDiagnostic) || !error.message.startsWith("ValueError:")) throw error;
      }
    }
    feature.set("geometry", geometry);
    return feature;
  }

  collection(rows: readonly (readonly TableValue[])[]): Map<string, JsonValue> {
    const features: JsonValue[] = [];
    let minLon: JsonValue = null; let minLat: JsonValue = null; let maxLon: JsonValue = null; let maxLat: JsonValue = null;
    const numeric = (value: JsonValue | undefined): number | bigint => {
      if (typeof value === "boolean") return Number(value);
      if (typeof value === "number") return value;
      if (typeof value === "object" && value !== null && "token" in value) return BigInt(value.token);
      throw new CsvkitBlocked("GeoJSON bbox nonnumeric coordinates");
    };
    const compare = (left: JsonValue, right: JsonValue, operator: "<" | ">"): boolean => {
      this.runtime.step();
      if (typeof left === "string" && typeof right === "string") {
        // Python compares Unicode code points, rather than UTF-16 code units.
        let a = 0; let b = 0;
        while (a < left.length && b < right.length) {
          this.runtime.step();
          const x = left.codePointAt(a)!; const y = right.codePointAt(b)!;
          if (x !== y) return operator === "<" ? x < y : x > y;
          a += x > 0xffff ? 2 : 1; b += y > 0xffff ? 2 : 1;
        }
        return operator === "<" ? left.length - a < right.length - b : left.length - a > right.length - b;
      }
      const type = (value: JsonValue): string => value === null ? "NoneType" :
        typeof value === "string" ? "str" : typeof value === "boolean" ? "bool" :
        typeof value === "number" ? "float" : value instanceof Map ? "dict" : Array.isArray(value) ? "list" : "int";
      const a = type(left); const b = type(right);
      if (a === "list" && b === "list") throw new CsvkitBlocked("GeoJSON bbox list comparison profile");
      if ([a, b].some(name => ["NoneType", "str", "dict", "list"].includes(name))) {
        throw new CsvkitDiagnostic(`TypeError: '${operator}' not supported between instances of '${a}' and '${b}'`);
      }
      return operator === "<" ? numeric(left) < numeric(right) : numeric(left) > numeric(right);
    };
    const coordinates = (value: JsonValue): void => {
      this.runtime.step();
      if (value instanceof Map && value.size <= 3) throw new CsvkitDiagnostic("KeyError: 0");
      if (!Array.isArray(value)) {
        const type = value === null ? "NoneType" : typeof value === "boolean" ? "bool" :
          typeof value === "number" ? "float" : typeof value === "object" && "token" in value ? "int" : null;
        if (type) throw new CsvkitDiagnostic(`TypeError: object of type '${type}' has no len()`);
        throw new CsvkitBlocked("GeoJSON bbox malformed coordinate profile");
      }
      if (!value.length) throw new CsvkitDiagnostic("IndexError: list index out of range");
      const first = value[0];
      if (value.length <= 3 && (typeof first === "number" || typeof first === "boolean" || typeof first === "object" && first !== null && "token" in first)) {
        if (value.length < 2) throw new CsvkitDiagnostic("IndexError: list index out of range");
        // Native bounds initialize each field before attempting comparisons.
        // In particular, the first latitude may be null or nonnumeric.
        if (minLon === null || compare(first!, minLon, "<")) minLon = first!;
        if (maxLon === null || compare(first!, maxLon, ">")) maxLon = first!;
        if (minLat === null || compare(value[1]!, minLat, "<")) minLat = value[1]!;
        if (maxLat === null || compare(value[1]!, maxLat, ">")) maxLat = value[1]!;
      } else for (const child of value) coordinates(child);
    };
    for (const row of rows) {
      const feature = this.feature(row);
      if (!this.runtime.options.no_bbox) {
        const geometry = feature.get("geometry");
        if (geometry === null) throw new CsvkitDiagnostic("TypeError: argument of type 'NoneType' is not a container or iterable");
        if (geometry instanceof Map) {
          if (geometry.has("coordinates")) coordinates(geometry.get("coordinates")!);
        } else if (Array.isArray(geometry)) {
          if (geometry.includes("coordinates")) throw new CsvkitDiagnostic("TypeError: list indices must be integers or slices, not str");
        } else if (typeof geometry === "string") {
          if (geometry.includes("coordinates")) throw new CsvkitDiagnostic("TypeError: string indices must be integers, not 'str'");
        } else {
          const type = typeof geometry === "boolean" ? "bool" : typeof geometry === "number" ? "float" : "int";
          throw new CsvkitDiagnostic(`TypeError: argument of type '${type}' is not a container or iterable`);
        }
      }
      features.push(feature);
    }
    const result = new Map<string, JsonValue>([["type", "FeatureCollection"]]);
    if (!this.runtime.options.no_bbox) result.set("bbox", [minLon, minLat, maxLon, maxLat]);
    result.set("features", features);
    if (this.runtime.options.crs) result.set("crs", new Map<string, JsonValue>([["type", "name"], ["properties", new Map([["name", String(this.runtime.options.crs)]])]]));
    return result;
  }
}
