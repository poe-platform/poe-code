
import type { SubstringObservation } from "./substring-native.js";

export const positionalSubstringCases = [
  { name: "leading-zero-name", source: 'printf "<%s>" "${00:1:2}"' },
  { name: "leading-zero-one", source: 'set -- abcdef; printf "<%s>" "${01:1:2}"' },
  { name: "leading-zero-ten", source: 'set -- a b c d e f g h i abcdef; printf "<%s>" "${010:1:2}"' },
  { name: "leading-zero-missing", source: 'printf "<%s>" "${099:1:2}"' },
];
export interface PositionalSubstringReference { profiles: { name: string; rows: { name: string; expected: SubstringObservation }[] }[] }
