import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { decodeImage } from "./codecs/index.js";
import { readImageResource } from "./image-resources.js";
// Frozen original text rasterization at 94c0d40dcb.
const vectors = [
  {
    spec: { text: "Hello", rgba: false },
    meta: {
      width: 29,
      height: 9,
      format: "raw",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      textAutofitDpi: 72
    },
    hash: "b728a4cc939412a4784a1c4100a233be7e8664c658b0b7c2a568defe8c03a1fc"
  },
  {
    spec: { text: "Hello", rgba: false, width: 13, height: 17 },
    meta: {
      width: 13,
      height: 17,
      format: "raw",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 136,
      hasAlpha: false,
      textAutofitDpi: 136
    },
    hash: "9ee2e9190dfc10cc4d76d75e0bcdd20c6ef9a0b36510bc8c6c132fe915cb7a02"
  },
  {
    spec: { text: "Hello", rgba: false, width: 40, dpi: 144 },
    meta: {
      width: 40,
      height: 18,
      format: "raw",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      textAutofitDpi: 144
    },
    hash: "635878942155c22e508715d29d0ed4fb4c558abf5dd7a9d55df3eae6deb77bb8"
  },
  {
    spec: { text: "Hello", rgba: false, width: 200, height: 27 },
    meta: {
      width: 200,
      height: 27,
      format: "raw",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 216,
      hasAlpha: false,
      textAutofitDpi: 216
    },
    hash: "bd1661e129902ee3d7eb1f3479ec23fe30f25c08ed38059d4f54bcb9e1e5a277"
  },
  {
    spec: { text: "Hello", rgba: true },
    meta: {
      width: 29,
      height: 9,
      format: "raw",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      textAutofitDpi: 72
    },
    hash: "7eac927e2dc33a986b04dee50fb3e6d5d2453247bc612c6516610cdfa10ebba6"
  },
  {
    spec: { text: "Hello", rgba: true, width: 13, height: 17 },
    meta: {
      width: 13,
      height: 17,
      format: "raw",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 136,
      hasAlpha: true,
      textAutofitDpi: 136
    },
    hash: "02ba27cb1311544fb0a1c57693cc7cc52e42648cadae357ece686ca5fe5b025d"
  },
  {
    spec: { text: "Hello", rgba: true, width: 40, dpi: 144 },
    meta: {
      width: 40,
      height: 18,
      format: "raw",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 144,
      hasAlpha: true,
      textAutofitDpi: 144
    },
    hash: "9354c0b0427409dca988c717a8f4e42f7d948e6de8400338bdc49c18fb1ac727"
  },
  {
    spec: { text: "Hello", rgba: true, width: 200, height: 27 },
    meta: {
      width: 200,
      height: 27,
      format: "raw",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 216,
      hasAlpha: true,
      textAutofitDpi: 216
    },
    hash: "83001683eb368634c24835b2608c70bba58e685a17b4ae08498ce1f2b790acf4"
  },
  {
    spec: { text: "A B\nC", rgba: false },
    meta: {
      width: 29,
      height: 9,
      format: "raw",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      textAutofitDpi: 72
    },
    hash: "2f18e29ae6beff48f09410793c6d9375f132c3ca8f2dea201102b3b987258bbc"
  },
  {
    spec: { text: "A B\nC", rgba: false, width: 13, height: 17 },
    meta: {
      width: 13,
      height: 17,
      format: "raw",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 136,
      hasAlpha: false,
      textAutofitDpi: 136
    },
    hash: "9318d12971b08a517c252a0d000ce35e0d008bf6d6b3475ee57c973df21642eb"
  },
  {
    spec: { text: "A B\nC", rgba: false, width: 40, dpi: 144 },
    meta: {
      width: 40,
      height: 18,
      format: "raw",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      textAutofitDpi: 144
    },
    hash: "17b8df0818dceb79e9a0e98a28116ed7df690f87176d6209af25a86eeeed741f"
  },
  {
    spec: { text: "A B\nC", rgba: false, width: 200, height: 27 },
    meta: {
      width: 200,
      height: 27,
      format: "raw",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 216,
      hasAlpha: false,
      textAutofitDpi: 216
    },
    hash: "494634d779e59d4d8a0e26935b39fd5095cb05fb5412a795659da5b85715ae6d"
  },
  {
    spec: { text: "A B\nC", rgba: true },
    meta: {
      width: 29,
      height: 9,
      format: "raw",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      textAutofitDpi: 72
    },
    hash: "efdd931ba1d5201d1be41f15fb08d8a27a5557745a07d3727026400a410a2b77"
  },
  {
    spec: { text: "A B\nC", rgba: true, width: 13, height: 17 },
    meta: {
      width: 13,
      height: 17,
      format: "raw",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 136,
      hasAlpha: true,
      textAutofitDpi: 136
    },
    hash: "acbfd8a6dfa83f8f57883b02c976aeb03821c728ba53b52cb576abd3621c7ebb"
  },
  {
    spec: { text: "A B\nC", rgba: true, width: 40, dpi: 144 },
    meta: {
      width: 40,
      height: 18,
      format: "raw",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 144,
      hasAlpha: true,
      textAutofitDpi: 144
    },
    hash: "4496509c476954bae6dafb9742c18cf282d13b5354d42a785ae4f1746991d0f1"
  },
  {
    spec: { text: "A B\nC", rgba: true, width: 200, height: 27 },
    meta: {
      width: 200,
      height: 27,
      format: "raw",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 216,
      hasAlpha: true,
      textAutofitDpi: 216
    },
    hash: "8aa94b5f373a1d2e1533e8ed0cce2d5732831c28481f1a04ea48845181cf2d67"
  },
  {
    spec: { text: '<span color="red" background="blue">Hi</span>!', rgba: false },
    meta: {
      width: 17,
      height: 9,
      format: "raw",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      textAutofitDpi: 72
    },
    hash: "d545a56303de05a7a6e2acb06efbed7734e05f22f946c11e5f7397c50c710f65"
  },
  {
    spec: {
      text: '<span color="red" background="blue">Hi</span>!',
      rgba: false,
      width: 13,
      height: 17
    },
    meta: {
      width: 13,
      height: 17,
      format: "raw",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 136,
      hasAlpha: false,
      textAutofitDpi: 136
    },
    hash: "701230cbc5db788bb45a0e1ee8d203079458a3c75519e48b3611b402308f5758"
  },
  {
    spec: {
      text: '<span color="red" background="blue">Hi</span>!',
      rgba: false,
      width: 40,
      dpi: 144
    },
    meta: {
      width: 40,
      height: 18,
      format: "raw",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      textAutofitDpi: 144
    },
    hash: "aad61c3737dff7374518853e2cf3f3886530092e0bc0b5bf62bce067c03ba68a"
  },
  {
    spec: {
      text: '<span color="red" background="blue">Hi</span>!',
      rgba: false,
      width: 200,
      height: 27
    },
    meta: {
      width: 200,
      height: 27,
      format: "raw",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 216,
      hasAlpha: false,
      textAutofitDpi: 216
    },
    hash: "89b401281a43dbaf639c834bfeeb3ba382e9d6cd59dfd6358e3e53ce281fa907"
  },
  {
    spec: { text: '<span color="red" background="blue">Hi</span>!', rgba: true },
    meta: {
      width: 17,
      height: 9,
      format: "raw",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      textAutofitDpi: 72
    },
    hash: "f7a30b34585c1c94507ea7d132d89b676cecb1be70129d82392b34908207bc1f"
  },
  {
    spec: {
      text: '<span color="red" background="blue">Hi</span>!',
      rgba: true,
      width: 13,
      height: 17
    },
    meta: {
      width: 13,
      height: 17,
      format: "raw",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 136,
      hasAlpha: true,
      textAutofitDpi: 136
    },
    hash: "2c9a3365affc0249e878398c69a5c0cb2f35e4d6f653b5c1d07d1863664d6259"
  },
  {
    spec: {
      text: '<span color="red" background="blue">Hi</span>!',
      rgba: true,
      width: 40,
      dpi: 144
    },
    meta: {
      width: 40,
      height: 18,
      format: "raw",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 144,
      hasAlpha: true,
      textAutofitDpi: 144
    },
    hash: "771dd46f92206c452bcd216eb8f16920a04765839afd5d4cb1542be85e9e0614"
  },
  {
    spec: {
      text: '<span color="red" background="blue">Hi</span>!',
      rgba: true,
      width: 200,
      height: 27
    },
    meta: {
      width: 200,
      height: 27,
      format: "raw",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 216,
      hasAlpha: true,
      textAutofitDpi: 216
    },
    hash: "657166077a5d40f6d2aee6bb1037c119fe990d92fa10db39649b4316032c71c5"
  },
  {
    spec: { text: '<SPAN foreground="rgba(12,34,56,0.5)" bgcolor="#f80">A😀</SPAN>', rgba: false },
    meta: {
      width: 17,
      height: 9,
      format: "raw",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      textAutofitDpi: 72
    },
    hash: "1b2fa007569d4a471f927770561430c3f02f711640f3f2d988e14a2842f1b492"
  },
  {
    spec: {
      text: '<SPAN foreground="rgba(12,34,56,0.5)" bgcolor="#f80">A😀</SPAN>',
      rgba: false,
      width: 13,
      height: 17
    },
    meta: {
      width: 13,
      height: 17,
      format: "raw",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 136,
      hasAlpha: false,
      textAutofitDpi: 136
    },
    hash: "c1a94b75ad4f7e922f42f68d83f5e8ca4bcf5e91ff87a813097600b6467ffbbb"
  },
  {
    spec: {
      text: '<SPAN foreground="rgba(12,34,56,0.5)" bgcolor="#f80">A😀</SPAN>',
      rgba: false,
      width: 40,
      dpi: 144
    },
    meta: {
      width: 40,
      height: 18,
      format: "raw",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      textAutofitDpi: 144
    },
    hash: "749e521572499cd4295994e9a51f36f2f8b3d8c8300e682ecc9f397be69b6c6c"
  },
  {
    spec: {
      text: '<SPAN foreground="rgba(12,34,56,0.5)" bgcolor="#f80">A😀</SPAN>',
      rgba: false,
      width: 200,
      height: 27
    },
    meta: {
      width: 200,
      height: 27,
      format: "raw",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 216,
      hasAlpha: false,
      textAutofitDpi: 216
    },
    hash: "2a96b229d3fe2b09566361c6528c4e00b9c679b72ce6377a84e5eedf5293b644"
  },
  {
    spec: { text: '<SPAN foreground="rgba(12,34,56,0.5)" bgcolor="#f80">A😀</SPAN>', rgba: true },
    meta: {
      width: 17,
      height: 9,
      format: "raw",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      textAutofitDpi: 72
    },
    hash: "ffc7cc1996d138d0ba9c3f656706ecd99d2c55719c6a526c776875d3d579a2c1"
  },
  {
    spec: {
      text: '<SPAN foreground="rgba(12,34,56,0.5)" bgcolor="#f80">A😀</SPAN>',
      rgba: true,
      width: 13,
      height: 17
    },
    meta: {
      width: 13,
      height: 17,
      format: "raw",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 136,
      hasAlpha: true,
      textAutofitDpi: 136
    },
    hash: "baa80a9612576338b9c5a004c146dbc96d246053cad4a4afdc1bf5513a993112"
  },
  {
    spec: {
      text: '<SPAN foreground="rgba(12,34,56,0.5)" bgcolor="#f80">A😀</SPAN>',
      rgba: true,
      width: 40,
      dpi: 144
    },
    meta: {
      width: 40,
      height: 18,
      format: "raw",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 144,
      hasAlpha: true,
      textAutofitDpi: 144
    },
    hash: "e24fa0ae34c7fd72073ac23680620b691fe706c2ddfdb10e04f8791a783c249b"
  },
  {
    spec: {
      text: '<SPAN foreground="rgba(12,34,56,0.5)" bgcolor="#f80">A😀</SPAN>',
      rgba: true,
      width: 200,
      height: 27
    },
    meta: {
      width: 200,
      height: 27,
      format: "raw",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 216,
      hasAlpha: true,
      textAutofitDpi: 216
    },
    hash: "e6bf3fd527b5921f256a0a51f4d75b6f44684bafdaedbb0d871334c5d6f6b8a1"
  },
  {
    spec: { text: "x<b>bold</b><>end<broken", rgba: false },
    meta: {
      width: 101,
      height: 9,
      format: "raw",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      textAutofitDpi: 72
    },
    hash: "143dbfdaf43a260c192a23d80a8aa774d2c392eb84232abac5f1ce1fa8f7650a"
  },
  {
    spec: { text: "x<b>bold</b><>end<broken", rgba: false, width: 13, height: 17 },
    meta: {
      width: 13,
      height: 17,
      format: "raw",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 136,
      hasAlpha: false,
      textAutofitDpi: 136
    },
    hash: "abc8302c165ca4f119104f3ddd6f7ae6cb8ec13fab184e20fbcbd0dbbb252868"
  },
  {
    spec: { text: "x<b>bold</b><>end<broken", rgba: false, width: 40, dpi: 144 },
    meta: {
      width: 40,
      height: 18,
      format: "raw",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      textAutofitDpi: 144
    },
    hash: "988dc6237a7517893f4d57df9f3c6127023f9a54d01839210b2e0e90af57dcf1"
  },
  {
    spec: { text: "x<b>bold</b><>end<broken", rgba: false, width: 200, height: 27 },
    meta: {
      width: 200,
      height: 27,
      format: "raw",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 216,
      hasAlpha: false,
      textAutofitDpi: 216
    },
    hash: "a0853d3eca0f04a7f99399109af1918979dd7c935c8dd60e4ef192e00c13a640"
  },
  {
    spec: { text: "x<b>bold</b><>end<broken", rgba: true },
    meta: {
      width: 101,
      height: 9,
      format: "raw",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      textAutofitDpi: 72
    },
    hash: "d0527d740fafa8e040bccda7f665f8db9f8382015bd172197c50fd8c37a7d3ab"
  },
  {
    spec: { text: "x<b>bold</b><>end<broken", rgba: true, width: 13, height: 17 },
    meta: {
      width: 13,
      height: 17,
      format: "raw",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 136,
      hasAlpha: true,
      textAutofitDpi: 136
    },
    hash: "f7b908841c93b91c881daec436fd5269d56da2626cf2c07a771a9079b6da36e0"
  },
  {
    spec: { text: "x<b>bold</b><>end<broken", rgba: true, width: 40, dpi: 144 },
    meta: {
      width: 40,
      height: 18,
      format: "raw",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 144,
      hasAlpha: true,
      textAutofitDpi: 144
    },
    hash: "98db6361640dcf6719ff990f5cecfc91065b3bc90b42f89091ec3713aaa90f6e"
  },
  {
    spec: { text: "x<b>bold</b><>end<broken", rgba: true, width: 200, height: 27 },
    meta: {
      width: 200,
      height: 27,
      format: "raw",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 216,
      hasAlpha: true,
      textAutofitDpi: 216
    },
    hash: "2a070aacf6e626ebb9218ef7cbc0485bb2ec5db660228ca99143df38769af486"
  },
  {
    spec: { text: '<span color="red">a<span color="blue">b</span>c</span>', rgba: false },
    meta: {
      width: 17,
      height: 9,
      format: "raw",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      textAutofitDpi: 72
    },
    hash: "db29c8b4e0b017185cd8bfbf879ee81a7ed1a77a6ba281ec1aeb013217d51a8a"
  },
  {
    spec: {
      text: '<span color="red">a<span color="blue">b</span>c</span>',
      rgba: false,
      width: 13,
      height: 17
    },
    meta: {
      width: 13,
      height: 17,
      format: "raw",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 136,
      hasAlpha: false,
      textAutofitDpi: 136
    },
    hash: "a4ad98a733db03df01b4bf6efab15c220ad9edc112488d082a5b73cfb32a40d2"
  },
  {
    spec: {
      text: '<span color="red">a<span color="blue">b</span>c</span>',
      rgba: false,
      width: 40,
      dpi: 144
    },
    meta: {
      width: 40,
      height: 18,
      format: "raw",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      textAutofitDpi: 144
    },
    hash: "7d0cbff17f00b7258f15cf4509255542c02a6b111fc991b37f5a356b8c51e8b9"
  },
  {
    spec: {
      text: '<span color="red">a<span color="blue">b</span>c</span>',
      rgba: false,
      width: 200,
      height: 27
    },
    meta: {
      width: 200,
      height: 27,
      format: "raw",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 216,
      hasAlpha: false,
      textAutofitDpi: 216
    },
    hash: "c7f5f711e2992ea27d23be6a3b6729052c04acaee5e0924b8e0dc5a990345b7e"
  },
  {
    spec: { text: '<span color="red">a<span color="blue">b</span>c</span>', rgba: true },
    meta: {
      width: 17,
      height: 9,
      format: "raw",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      textAutofitDpi: 72
    },
    hash: "d591506d30f89b020d97f3c4b27992c2c194ba784a2732ffb8377d855c356218"
  },
  {
    spec: {
      text: '<span color="red">a<span color="blue">b</span>c</span>',
      rgba: true,
      width: 13,
      height: 17
    },
    meta: {
      width: 13,
      height: 17,
      format: "raw",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 136,
      hasAlpha: true,
      textAutofitDpi: 136
    },
    hash: "0b23e6dec804faa51b333554ad21d8bc01f49ee5f539ca8c27ca205845a64b0c"
  },
  {
    spec: {
      text: '<span color="red">a<span color="blue">b</span>c</span>',
      rgba: true,
      width: 40,
      dpi: 144
    },
    meta: {
      width: 40,
      height: 18,
      format: "raw",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 144,
      hasAlpha: true,
      textAutofitDpi: 144
    },
    hash: "85aa7cba50caf508a288d5db1c7efbe006453ea39adc8d164c92ca09d69136f7"
  },
  {
    spec: {
      text: '<span color="red">a<span color="blue">b</span>c</span>',
      rgba: true,
      width: 200,
      height: 27
    },
    meta: {
      width: 200,
      height: 27,
      format: "raw",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 216,
      hasAlpha: true,
      textAutofitDpi: 216
    },
    hash: "fe5c57283163f6d78e8afafb05ecd81257ece4e8fe662cdd81330c0604a45e65"
  },
  {
    spec: { text: '<spanner fgcolor="green"> x </SPAN>', rgba: false },
    meta: {
      width: 17,
      height: 9,
      format: "raw",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      textAutofitDpi: 72
    },
    hash: "8f604e477f6a89bf4203960fe1531a3685c348befab28eb12104c64b89a0ab8e"
  },
  {
    spec: { text: '<spanner fgcolor="green"> x </SPAN>', rgba: false, width: 13, height: 17 },
    meta: {
      width: 13,
      height: 17,
      format: "raw",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 136,
      hasAlpha: false,
      textAutofitDpi: 136
    },
    hash: "ecf9fb6588fa7b2c6059ed4494acc1cf5bb3e67b7f417b0df0a66b6ecae89489"
  },
  {
    spec: { text: '<spanner fgcolor="green"> x </SPAN>', rgba: false, width: 40, dpi: 144 },
    meta: {
      width: 40,
      height: 18,
      format: "raw",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      textAutofitDpi: 144
    },
    hash: "593179430658250373fbab4712966a88e29edb70fd771dfda0bfd8cfa4fab352"
  },
  {
    spec: { text: '<spanner fgcolor="green"> x </SPAN>', rgba: false, width: 200, height: 27 },
    meta: {
      width: 200,
      height: 27,
      format: "raw",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 216,
      hasAlpha: false,
      textAutofitDpi: 216
    },
    hash: "0e4cb9361f248674166064c9d8743b0a24a8ea3ca585523b03ed07b9ea4db95d"
  },
  {
    spec: { text: '<spanner fgcolor="green"> x </SPAN>', rgba: true },
    meta: {
      width: 17,
      height: 9,
      format: "raw",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      textAutofitDpi: 72
    },
    hash: "8fdf572fa1db39cd591506de62a9852c03c3d54c62825a82a737c71f07d7632a"
  },
  {
    spec: { text: '<spanner fgcolor="green"> x </SPAN>', rgba: true, width: 13, height: 17 },
    meta: {
      width: 13,
      height: 17,
      format: "raw",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 136,
      hasAlpha: true,
      textAutofitDpi: 136
    },
    hash: "ce7714a9d40e7ed6c8c294e3b3ac7e0cb47e78b8daee06ab340eb75d2ee459f3"
  },
  {
    spec: { text: '<spanner fgcolor="green"> x </SPAN>', rgba: true, width: 40, dpi: 144 },
    meta: {
      width: 40,
      height: 18,
      format: "raw",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 144,
      hasAlpha: true,
      textAutofitDpi: 144
    },
    hash: "5cfcd1063985dea0b2de525b280e82183342fc58b4ec4d7dc0d75b5710b71d34"
  },
  {
    spec: { text: '<spanner fgcolor="green"> x </SPAN>', rgba: true, width: 200, height: 27 },
    meta: {
      width: 200,
      height: 27,
      format: "raw",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 216,
      hasAlpha: true,
      textAutofitDpi: 216
    },
    hash: "03e8002ab8d7072cc4c3cb9e5dd9ec24581a4733f342265e8067b3be5d91d45c"
  },
  {
    spec: { text: "<span color=\"red'>x</span>", rgba: false },
    meta: {
      width: 5,
      height: 9,
      format: "raw",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      textAutofitDpi: 72
    },
    hash: "2b75f0ab8bfc382fdc89b8796f63d8a2fb483a1be5bf2dfb08724358fa133b37"
  },
  {
    spec: { text: "<span color=\"red'>x</span>", rgba: false, width: 13, height: 17 },
    meta: {
      width: 13,
      height: 17,
      format: "raw",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 136,
      hasAlpha: false,
      textAutofitDpi: 136
    },
    hash: "2432e64645528758d501a11f9afd174b675ed3b54d9868b908c44dc095536b82"
  },
  {
    spec: { text: "<span color=\"red'>x</span>", rgba: false, width: 40, dpi: 144 },
    meta: {
      width: 40,
      height: 18,
      format: "raw",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      textAutofitDpi: 144
    },
    hash: "df6d577211be5c19c35b34f89852cc4d2555fc3577eb1b002b2f57e038804b18"
  },
  {
    spec: { text: "<span color=\"red'>x</span>", rgba: false, width: 200, height: 27 },
    meta: {
      width: 200,
      height: 27,
      format: "raw",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 216,
      hasAlpha: false,
      textAutofitDpi: 216
    },
    hash: "87f052e89614d437756f2fc301b00ab3db4b65c1b418c9884d3b0bd26b0a8446"
  },
  {
    spec: { text: "<span color=\"red'>x</span>", rgba: true },
    meta: {
      width: 5,
      height: 9,
      format: "raw",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      textAutofitDpi: 72
    },
    hash: "5368e720478fdf3518eb0bd39d91c40175b6751272fb05c886511f3a0abfeaaa"
  },
  {
    spec: { text: "<span color=\"red'>x</span>", rgba: true, width: 13, height: 17 },
    meta: {
      width: 13,
      height: 17,
      format: "raw",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 136,
      hasAlpha: true,
      textAutofitDpi: 136
    },
    hash: "ebbc081833534b677c625127122964275f88c0f01c9dc3d06aad6322f15d2a6e"
  },
  {
    spec: { text: "<span color=\"red'>x</span>", rgba: true, width: 40, dpi: 144 },
    meta: {
      width: 40,
      height: 18,
      format: "raw",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 144,
      hasAlpha: true,
      textAutofitDpi: 144
    },
    hash: "40d2972e9951ca62b3f11b55046eda4a0183b4669800331b7e5c93d986d4063c"
  },
  {
    spec: { text: "<span color=\"red'>x</span>", rgba: true, width: 200, height: 27 },
    meta: {
      width: 200,
      height: 27,
      format: "raw",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 216,
      hasAlpha: true,
      textAutofitDpi: 216
    },
    hash: "fa0a4d5ec0f215c24e036be2b45ae88297430ebe1fd6f24707a4694924057b51"
  },
  {
    spec: { text: '<span color="">z</span>', rgba: false },
    meta: {
      width: 5,
      height: 9,
      format: "raw",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      textAutofitDpi: 72
    },
    hash: "d078fab23b4e0193376693f174155d62fcf9c6abdefe5a32d800af45e7124409"
  },
  {
    spec: { text: '<span color="">z</span>', rgba: false, width: 13, height: 17 },
    meta: {
      width: 13,
      height: 17,
      format: "raw",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 136,
      hasAlpha: false,
      textAutofitDpi: 136
    },
    hash: "d7224c340b9d654577e3fde429222252e14417674b06082fe30598020b89bb07"
  },
  {
    spec: { text: '<span color="">z</span>', rgba: false, width: 40, dpi: 144 },
    meta: {
      width: 40,
      height: 18,
      format: "raw",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      textAutofitDpi: 144
    },
    hash: "2f56dde5e2161a65ca81a65ed65e1928aad2fdda584201f4c3b051e207779347"
  },
  {
    spec: { text: '<span color="">z</span>', rgba: false, width: 200, height: 27 },
    meta: {
      width: 200,
      height: 27,
      format: "raw",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 216,
      hasAlpha: false,
      textAutofitDpi: 216
    },
    hash: "c156734bc87d3143ac65b08bbdcd4c33f6f331193b2986ba1f4ecdc60b907363"
  },
  {
    spec: { text: '<span color="">z</span>', rgba: true },
    meta: {
      width: 5,
      height: 9,
      format: "raw",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      textAutofitDpi: 72
    },
    hash: "3ff4a2376c99415cc368ce365c22d890c1166961084a72353e6799f51a0ed813"
  },
  {
    spec: { text: '<span color="">z</span>', rgba: true, width: 13, height: 17 },
    meta: {
      width: 13,
      height: 17,
      format: "raw",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 136,
      hasAlpha: true,
      textAutofitDpi: 136
    },
    hash: "bfcc1db63be443fa62ee7691d7cd156afab38014beced8fb9d090642139a2b37"
  },
  {
    spec: { text: '<span color="">z</span>', rgba: true, width: 40, dpi: 144 },
    meta: {
      width: 40,
      height: 18,
      format: "raw",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 144,
      hasAlpha: true,
      textAutofitDpi: 144
    },
    hash: "ecc63b3f297dc0129f1c31a8fbf162221239b3a34b94c959970eb19b87772c7f"
  },
  {
    spec: { text: '<span color="">z</span>', rgba: true, width: 200, height: 27 },
    meta: {
      width: 200,
      height: 27,
      format: "raw",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 216,
      hasAlpha: true,
      textAutofitDpi: 216
    },
    hash: "5b48bd40aa2acef6fea0706bdc6f4131f78a06dc44f2c19c0425b322770f0af3"
  },
  {
    spec: { text: '<span color="invalid-color">z</span>', rgba: false },
    error: "Unable to parse color from string: invalid-color"
  },
  {
    spec: { text: '<span color="invalid-color">z</span>', rgba: false, width: 13, height: 17 },
    error: "Unable to parse color from string: invalid-color"
  },
  {
    spec: { text: '<span color="invalid-color">z</span>', rgba: false, width: 40, dpi: 144 },
    error: "Unable to parse color from string: invalid-color"
  },
  {
    spec: { text: '<span color="invalid-color">z</span>', rgba: false, width: 200, height: 27 },
    error: "Unable to parse color from string: invalid-color"
  },
  {
    spec: { text: '<span color="invalid-color">z</span>', rgba: true },
    error: "Unable to parse color from string: invalid-color"
  },
  {
    spec: { text: '<span color="invalid-color">z</span>', rgba: true, width: 13, height: 17 },
    error: "Unable to parse color from string: invalid-color"
  },
  {
    spec: { text: '<span color="invalid-color">z</span>', rgba: true, width: 40, dpi: 144 },
    error: "Unable to parse color from string: invalid-color"
  },
  {
    spec: { text: '<span color="invalid-color">z</span>', rgba: true, width: 200, height: 27 },
    error: "Unable to parse color from string: invalid-color"
  },
  {
    spec: { text: "<b></b>", rgba: false },
    meta: {
      width: 5,
      height: 9,
      format: "raw",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      textAutofitDpi: 72
    },
    hash: "db714ea6ebb8ae05c12b609e6eea95c25d319077b6957940ea5912f730f92a96"
  },
  {
    spec: { text: "<b></b>", rgba: false, width: 13, height: 17 },
    meta: {
      width: 13,
      height: 17,
      format: "raw",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 136,
      hasAlpha: false,
      textAutofitDpi: 136
    },
    hash: "ef5a59df0821170b2aec1ae542ba666d7c29dc01a4284f1030ff02ce06d351f7"
  },
  {
    spec: { text: "<b></b>", rgba: false, width: 40, dpi: 144 },
    meta: {
      width: 40,
      height: 18,
      format: "raw",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 144,
      hasAlpha: false,
      textAutofitDpi: 144
    },
    hash: "d48a7e36918af935814893429d516af6b8b76c30e4aedd3fe2fbb296b83f3c9c"
  },
  {
    spec: { text: "<b></b>", rgba: false, width: 200, height: 27 },
    meta: {
      width: 200,
      height: 27,
      format: "raw",
      space: "b-w",
      channels: 1,
      depth: "uchar",
      density: 216,
      hasAlpha: false,
      textAutofitDpi: 216
    },
    hash: "1717457f17c38deff1ab28c1653fdec02857fdc1a3a9812ff1d2acf3ec18a84e"
  },
  {
    spec: { text: "<b></b>", rgba: true },
    meta: {
      width: 5,
      height: 9,
      format: "raw",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      textAutofitDpi: 72
    },
    hash: "10b2a66888c58a54b277fe2e68fb6e87150c3cd2c537b7f6a2d84559017438c7"
  },
  {
    spec: { text: "<b></b>", rgba: true, width: 13, height: 17 },
    meta: {
      width: 13,
      height: 17,
      format: "raw",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 136,
      hasAlpha: true,
      textAutofitDpi: 136
    },
    hash: "6ca83adefc47fc9ab71637c150b95b33083e61e507dff2ee5f2692aa27e1453e"
  },
  {
    spec: { text: "<b></b>", rgba: true, width: 40, dpi: 144 },
    meta: {
      width: 40,
      height: 18,
      format: "raw",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 144,
      hasAlpha: true,
      textAutofitDpi: 144
    },
    hash: "39a68c2004ed4a20edb148b72e5aabd663f15cce54b30d2ea1c106e839761ed5"
  },
  {
    spec: { text: "<b></b>", rgba: true, width: 200, height: 27 },
    meta: {
      width: 200,
      height: 27,
      format: "raw",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 216,
      hasAlpha: true,
      textAutofitDpi: 216
    },
    hash: "47ed6857115d8bab2ffd4af6952f5530694e174389ffce90c522fd30255d659d"
  }
];
it.each(vectors)("retains text raster semantics %j", async (v) => {
  const memory = new Uint8Array(128 * 1024);
  let end = 17;
  const storage = {
    allocate(length: number) {
      const at = end;
      end += length;
      return at;
    },
    async read(at: number, length: number) {
      expect(length).toBeLessThanOrEqual(4096);
      return memory.subarray(at, at + length);
    },
    async write(at: number, bytes: Uint8Array) {
      expect(bytes.length).toBeLessThanOrEqual(4096);
      memory.set(bytes, at);
    }
  };
  const result = readImageResource(
    undefined,
    { text: v.spec, density: 96 },
    new MemoryFileSystem(),
    storage,
    new AbortController().signal
  );
  if (v.error) {
    await expect(result).rejects.toThrow(v.error);
    expect(() => decodeImage(undefined, { text: v.spec, density: 96 })).toThrow(v.error);
    return;
  }
  const { position, ...meta } = await result;
  expect(meta).toEqual(v.meta);
  expect(
    createHash("sha256")
      .update(memory.subarray(position, position + meta.width * meta.height * 4))
      .digest("hex")
  ).toBe(v.hash);
  const { data, ...buffered } = decodeImage(undefined, { text: v.spec, density: 96 });
  expect(buffered).toEqual(v.meta);
  expect(createHash("sha256").update(data).digest("hex")).toBe(v.hash);
});

import sharp from "./index.js";
import { renderTextToStorage } from "./codecs/text-storage.js";
import { vi } from "vitest";
it.each(["over", "multiply", "source"] as const)(
  "composites text with %s without whole-file I/O",
  async (blend) => {
    const fs = new MemoryFileSystem(),
      input = sharp({
        create: {
          width: 67,
          height: 39,
          channels: 4,
          background: { r: 10, g: 30, b: 90, alpha: 0.5 }
        }
      })
        .png()
        .toBufferSync();
    await fs.writeFile("/in", input);
    const guarded = new Proxy(fs, {
      get(target, key) {
        if (key === "readFile" || key === "writeFile")
          return () => {
            throw new Error("whole-file I/O forbidden");
          };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
    });
    const layers = [
      {
        input: { text: { text: '<span color="red" background="blue">Hello</span>', rgba: true } },
        blend,
        tile: true
      }
    ];
    const expected = sharp(input).composite(layers).png().toBufferSync();
    await sharp("/in", { filesystem: guarded }).composite(layers).png().toFile("/out");
    expect(
      sharp(await fs.readFile("/out"))
        .raw()
        .toBufferSync()
    ).toEqual(sharp(expected).raw().toBufferSync());
    expect((await fs.readdir("/")).map((e) => e.name)).toEqual(["in", "out"]);
  }
);
it("bounds allocations for wide text and repeated style spans", async () => {
  const text = '<span color="red">a</span>'.repeat(10000),
    signal = new AbortController().signal,
    Native = Uint8Array;
  let max = 0,
    writes = 0;
  vi.stubGlobal(
    "Uint8Array",
    new Proxy(Native, {
      construct(target, args) {
        if (typeof args[0] === "number") max = Math.max(max, args[0]);
        return Reflect.construct(target, args);
      }
    })
  );
  try {
    const result = await renderTextToStorage(
      { text: { text, width: 8193, height: 19, rgba: true } },
      {
        allocate(length) {
          expect(length).toBe(8193 * 19 * 4);
          return 19;
        },
        async read() {
          throw new Error("no read needed");
        },
        async write(_at, bytes) {
          expect(bytes.length).toBeLessThanOrEqual(4096);
          writes++;
        }
      },
      signal
    );
    expect(result.width).toBe(8193);
    expect(writes).toBeGreaterThan(32);
    expect(max).toBeLessThanOrEqual(4096);
  } finally {
    vi.unstubAllGlobals();
  }
});
for (const cancel of [false, true])
  it(`propagates backing ${cancel ? "cancellation" : "failure"}`, async () => {
    const controller = new AbortController(),
      reason = new Error("backing failure");
    let writes = 0;
    await expect(
      renderTextToStorage(
        { text: { text: "Hello", width: 1024, height: 1024 } },
        {
          allocate() {
            return 0;
          },
          async read() {
            throw new Error("unexpected read");
          },
          async write() {
            writes++;
            if (cancel) controller.abort(reason);
            else throw reason;
          }
        },
        controller.signal
      )
    ).rejects.toBe(reason);
    expect(writes).toBe(1);
  });

it("publishes generated text through caller storage without whole-file writes", async () => {
  const fs = new MemoryFileSystem(),
    guarded = new Proxy(fs, {
      get(target, key) {
        if (key === "readFile" || key === "writeFile")
          return () => {
            throw new Error("whole-file I/O forbidden");
          };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
    }),
    text = { text: '<span color="red">Generated</span>', width: 173, height: 31, rgba: true };
  const expected = sharp({ text }).resize(73, 19).png().toBufferWithObjectSync();
  const info = await sharp({ text, filesystem: guarded }).resize(73, 19).png().toFile("/out.png");
  const bytes = await fs.readFile("/out.png");
  expect(info).toEqual({ ...expected.info, size: bytes.length });
  expect(sharp(bytes).raw().toBufferSync()).toEqual(sharp(expected.data).raw().toBufferSync());
  expect((await fs.readdir("/")).map((e) => e.name)).toEqual(["out.png"]);
});

it("publishes generated color images without acquiring input read authority", async () => {
  const fs = new MemoryFileSystem(),
    create = { width: 71, height: 29, channels: 3 as const, background: "red" },
    guarded = new Proxy(fs, {
      get(target, key) {
        if (key === "readFile" || key === "writeFile" || key === "openReadFile")
          return () => {
            throw new Error("input/whole-file I/O forbidden");
          };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
    });
  const expected = sharp({ create }).rotate(13).png().toBufferWithObjectSync();
  const info = await sharp({ create, filesystem: guarded }).rotate(13).png().toFile("/out.png");
  const bytes = await fs.readFile("/out.png");
  expect(info).toEqual({ ...expected.info, size: bytes.length });
  expect(sharp(bytes).raw().toBufferSync()).toEqual(sharp(expected.data).raw().toBufferSync());
});
for (const cancel of [false, true])
  it(`preserves the destination and closes text scratch after publication ${cancel ? "cancellation" : "failure"}`, async () => {
    const fs = new MemoryFileSystem(),
      before = Uint8Array.of(7, 8, 9),
      controller = new AbortController(),
      reason = new Error("publication failed");
    await fs.writeFile("/out.png", before);
    let opened = 0,
      closed = 0;
    const guarded = new Proxy(fs, {
      get(target, key) {
        if (key === "publishFileConditional" || key === "publishStagedFile")
          return async () => {
            if (cancel) controller.abort(reason);
            throw reason;
          };
        if (key === "open")
          return async (...args: Parameters<typeof fs.open>) => {
            const handle = await fs.open(...args);
            opened++;
            return new Proxy(handle, {
              get(t, k) {
                if (k === "close")
                  return async () => {
                    closed++;
                    await t.close();
                  };
                const value = Reflect.get(t, k, t);
                return typeof value === "function" ? value.bind(t) : value;
              }
            });
          };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
    });
    await expect(
      sharp({
        text: { text: "Large text", width: 1024, height: 513 },
        filesystem: guarded,
        signal: controller.signal
      })
        .png()
        .toFile("/out.png")
    ).rejects.toBe(reason);
    expect(opened).toBeGreaterThan(0);
    expect(closed).toBe(opened);
    expect(await fs.readFile("/out.png")).toEqual(before);
    expect((await fs.readdir("/")).map((e) => e.name)).toEqual(["out.png"]);
  });

it("reads text metadata without allocating its pixel canvas", async () => {
  const Native = Uint8Array;
  let max = 0;
  vi.stubGlobal(
    "Uint8Array",
    new Proxy(Native, {
      construct(target, args) {
        if (typeof args[0] === "number") {
          max = Math.max(max, args[0]);
          if (args[0] > 4096) throw new Error("full text canvas forbidden");
        }
        return Reflect.construct(target, args);
      }
    })
  );
  try {
    const metadata = await sharp({
      text: { text: "metadata", width: 8192, height: 8192, rgba: true }
    }).metadata();
    expect(metadata.width).toBe(8192);
    expect(metadata.height).toBe(8192);
    expect(max).toBeLessThanOrEqual(4096);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("owns the text value across asynchronous backing writes", async () => {
  const options = {
      text: { text: '<span color="red">AAAAA</span>', width: 257, height: 33, rgba: true }
    },
    expected = decodeImage(undefined, options),
    memory = new Uint8Array(257 * 33 * 4);
  let writes = 0;
  await renderTextToStorage(
    options,
    {
      allocate() {
        return 0;
      },
      async read() {
        throw new Error("unexpected read");
      },
      async write(at, bytes) {
        memory.set(bytes, at);
        if (++writes === 1) options.text.text = '<span color="blue">ZZZZZ</span>';
      }
    },
    new AbortController().signal
  );
  expect(memory).toEqual(expected.data);
});
