import {jisx0212_decmap} from "./euc-jp-data.js";
import {createIso2022JpCodec} from "./iso2022-jp-codec.js";

/** CPython 3.14.7 JP-EXT: JIS 0208, 0212, Roman and half-width kana. */
export const iso2022JpExtCodec=createIso2022JpCodec("iso2022_jp_ext",jisx0212_decmap,true);
