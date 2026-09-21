import {fileURLToPath} from 'node:url';
import {native} from './native.js';
export const JETBRAINS_MONO_BASE64=native.terminalRegularBase64();
export const FONT_FACE_CSS=native.terminalFontFaceCss();
export const JETBRAINS_MONO_FONT_FILES=Object.freeze(['400-normal','700-normal','400-italic','700-italic'].map(face=>fileURLToPath(new URL('../assets/jetbrains-mono-'+face+'.ttf',import.meta.url))));
export const JETBRAINS_MONO_TTF_PATH=JETBRAINS_MONO_FONT_FILES[0];
