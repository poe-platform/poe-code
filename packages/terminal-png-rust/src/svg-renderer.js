import {native,encoded} from './native.js';
export function renderSvg(runs,options={}){return native.renderTerminalSvg(encoded(runs),encoded(options));}
