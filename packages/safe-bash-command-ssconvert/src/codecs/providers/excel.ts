import { xlsFormat } from "../../formats/xls.js";
import { xlsxFormat } from "../../formats/xlsx.js";
import { spreadsheetmlFormat } from "../../formats/spreadsheetml.js";

// The explicit-encoding reader follows all automatic formats in native registration.
export default { ...xlsFormat, services: [
  ...xlsFormat.services.slice(0, -1), ...spreadsheetmlFormat.services, ...xlsxFormat.services,
  xlsFormat.services.at(-1)!
] };
