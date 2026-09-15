import {jisx0212_decmap} from "./euc-jp-data.js";
import {createIso2022JpCodec} from "./iso2022-jp-codec.js";

/** JP-1 adds JIS X 0212 using its independently pinned directional mappings. */
export const iso2022Jp1Codec=createIso2022JpCodec("iso2022_jp_1",jisx0212_decmap);
