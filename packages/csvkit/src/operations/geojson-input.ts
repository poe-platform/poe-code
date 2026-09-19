import type { Runtime } from '../runtime.js';
import { decodeJson, type JsonInput } from '../json-input.js';
import { CsvkitBlocked, CsvkitDiagnostic } from '../errors.js';
import { repr } from '../cli/parser.js';
import { writeCsvRow } from '../csv.js';
import { floatText } from './json-table.js';

/** json.dumps default separators/ensure_ascii, without losing object order. */
function json(value: JsonInput, runtime: Runtime): string {
  runtime.step();
  if (value instanceof Map) return '{' + [...value].map(([key, child]) => json(key, runtime) + ': ' + json(child, runtime)).join(', ') + '}';
  if (Array.isArray(value)) return '[' + value.map(child => json(child, runtime)).join(', ') + ']';
  if (value !== null && typeof value === 'object') return number(value.token, true);
  const encoded = JSON.stringify(value);
  let ascii = '';
  for (let index = 0; index < encoded.length; index++) {
    runtime.step(); const code = encoded.charCodeAt(index);
    ascii += code >= 127 ? '\\u' + code.toString(16).padStart(4, '0') : encoded[index];
  }
  return ascii;
}
function number(token: string, dump = false): string {
  if (!token.includes('.') && !token.toLowerCase().includes('e') && !['NaN', 'Infinity', '-Infinity'].includes(token)) return token === '-0' ? '0' : token;
  const value = Number(token);
  if (!dump && !Number.isFinite(value)) return Number.isNaN(value) ? 'nan' : value < 0 ? '-inf' : 'inf';
  return floatText(value);
}
function cell(value: JsonInput | undefined, runtime: Runtime, property = false): string | null {
  if (value === undefined || value === null) return null;
  if (value instanceof Map) return property ? json(value, runtime) : pythonRepr(value, runtime);
  if (Array.isArray(value)) return pythonRepr(value, runtime);
  if (typeof value === 'object') return number(value.token);
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  return value;
}
function pythonRepr(value: JsonInput, runtime: Runtime): string {
  runtime.step();
  if (value === null) return 'None';
  if (typeof value === 'string') return repr(value);
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (Array.isArray(value)) return '[' + value.map(child => pythonRepr(child, runtime)).join(', ') + ']';
  if (value instanceof Map) return value.size ? 'OrderedDict({' + [...value].map(([key, child]) => repr(key) + ': ' + pythonRepr(child, runtime)).join(', ') + '})' : 'OrderedDict()';
  return number(value.token);
}
function typeName(value: JsonInput | undefined): string {
  if (value === undefined || value === null) return 'NoneType';
  if (typeof value === 'string') return 'str';
  if (typeof value === 'boolean') return 'bool';
  if (Array.isArray(value)) return 'list';
  if (value instanceof Map) return 'collections.OrderedDict';
  return value.token.includes('.') || value.token.toLowerCase().includes('e') || ['NaN', 'Infinity', '-Infinity'].includes(value.token) ? 'float' : 'int';
}
function truthy(value: JsonInput): boolean {
  if (value === null || value === false || value === '') return false;
  if (value instanceof Map) return value.size !== 0;
  if (Array.isArray(value)) return value.length !== 0;
  return typeof value !== 'object' || Number(value.token) !== 0;
}
export async function geojsonConversion(runtime: Runtime): Promise<number> {
  const input = decodeJson(await runtime.text(undefined, 0), runtime);
  if (!(input instanceof Map)) throw new CsvkitDiagnostic('TypeError: JSON document is not valid GeoJSON: Root element is not an object.');
  if (!input.has('type')) throw new CsvkitDiagnostic('TypeError: JSON document is not valid GeoJSON: No top-level "type" key.');
  const rootType = input.get('type')!;
  if (rootType !== 'FeatureCollection') throw new CsvkitDiagnostic(`TypeError: Only GeoJSON with root FeatureCollection type is supported. Not ${typeof rootType === 'string' ? rootType : pythonRepr(rootType, runtime)}`);
  if (!input.has('features')) throw new CsvkitDiagnostic('TypeError: JSON document is not a valid FeatureCollection: No top-level "features" key.');
  const features = input.get('features');
  const iterable = Array.isArray(features) ? features : features instanceof Map ? [...features.keys()] : typeof features === 'string' ? Array.from(features) : undefined;
  if (!iterable) throw new CsvkitDiagnostic(`TypeError: '${typeName(features)}' object is not iterable`);
  if (runtime.context.limits.maxColumns < 5) throw new CsvkitBlocked('column budget exceeded');
  const properties: string[] = []; const known = new Set<string>();
  const parsed: { id: JsonInput | undefined; props: Map<string, JsonInput>; geometry: JsonInput; type: JsonInput | undefined; lon: JsonInput | undefined; lat: JsonInput | undefined }[] = [];
  for (const feature of iterable) {
    runtime.step();
    if (!(feature instanceof Map)) throw new CsvkitDiagnostic(`AttributeError: '${typeName(feature)}' object has no attribute 'get'`);
    const props = feature.has('properties') ? feature.get('properties')! : new Map<string, JsonInput>();
    if (!(props instanceof Map)) throw new CsvkitDiagnostic(`AttributeError: '${typeName(props)}' object has no attribute 'keys'`);
    for (const key of props.keys()) if (!known.has(key)) {
      if (properties.length + 5 >= runtime.context.limits.maxColumns) throw new CsvkitBlocked('column budget exceeded');
      runtime.retain(64 + key.length * 2); known.add(key); properties.push(key);
    }
    if (!feature.has('geometry')) throw new CsvkitDiagnostic(`KeyError: ${repr('geometry')}`);
    const geometry = feature.get('geometry')!;
    if (truthy(geometry) && !(geometry instanceof Map)) throw new CsvkitDiagnostic(`AttributeError: '${typeName(geometry)}' object has no attribute 'get'`);
    const type = geometry instanceof Map ? geometry.get('type') : undefined;
    let lon: JsonInput | undefined; let lat: JsonInput | undefined;
    if (type === 'Point' && geometry instanceof Map && geometry.has('coordinates')) {
      const coordinates = geometry.get('coordinates');
      const values = Array.isArray(coordinates) ? coordinates : typeof coordinates === 'string' ? Array.from(coordinates) : undefined;
      if (!values) throw new CsvkitDiagnostic(coordinates instanceof Map ? 'KeyError: slice(0, 2, None)' : `TypeError: '${typeName(coordinates)}' object is not subscriptable`);
      if (values.length < 2) throw new CsvkitDiagnostic(`ValueError: not enough values to unpack (expected 2, got ${values.length})`);
      [lon, lat] = values;
    }
    runtime.retain(128); parsed.push({ id: feature.get('id'), props, geometry, type, lon, lat });
  }
  const headers = ['id', ...properties, 'geojson', 'type', 'longitude', 'latitude'];
  const output = [writeCsvRow(headers)];
  for (const feature of parsed) {
    const cells = [cell(feature.id, runtime), ...properties.map(key => cell(feature.props.get(key), runtime, true)), json(feature.geometry, runtime), cell(feature.type, runtime), cell(feature.lon, runtime), cell(feature.lat, runtime)];
    runtime.admitRecord({ cells: cells.map(value => value ?? ''), line: output.length });
    const row = writeCsvRow(cells); runtime.retain(row.length * 2); output.push(row);
  }
  // The upstream converter returns one complete string and ignores writer/line-number flags.
  await runtime.write(output.join(''));
  return 0;
}
