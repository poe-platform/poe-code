export const shapeAdjustmentDefaults: Readonly<
  Record<string, readonly (readonly [string, number])[]>
> = {
  ARC: [
    ["adj1", 16200000],
    ["adj2", 0]
  ],
  BALLOON: [
    ["adj1", -20833],
    ["adj2", 62500],
    ["adj3", 16667]
  ],
  BENT_ARROW: [
    ["adj1", 25000],
    ["adj2", 25000],
    ["adj3", 25000],
    ["adj4", 43750]
  ],
  BENT_UP_ARROW: [
    ["adj1", 25000],
    ["adj2", 25000],
    ["adj3", 25000]
  ],
  BEVEL: [["adj", 12500]],
  BLOCK_ARC: [
    ["adj1", 10800000],
    ["adj2", 0],
    ["adj3", 25000]
  ],
  CAN: [["adj", 25000]],
  CHEVRON: [["adj", 50000]],
  CHORD: [
    ["adj1", 2700000],
    ["adj2", 16200000]
  ],
  CIRCULAR_ARROW: [
    ["adj1", 12500],
    ["adj2", 1142319],
    ["adj3", 20457681],
    ["adj4", 10800000],
    ["adj5", 12500]
  ],
  CLOUD_CALLOUT: [
    ["adj1", -20833],
    ["adj2", 62500]
  ],
  CORNER: [
    ["adj1", 50000],
    ["adj2", 50000]
  ],
  CROSS: [["adj", 25000]],
  CUBE: [["adj", 25000]],
  CURVED_DOWN_ARROW: [
    ["adj1", 25000],
    ["adj2", 50000],
    ["adj3", 25000]
  ],
  CURVED_DOWN_RIBBON: [
    ["adj1", 25000],
    ["adj2", 50000],
    ["adj3", 12500]
  ],
  CURVED_LEFT_ARROW: [
    ["adj1", 25000],
    ["adj2", 50000],
    ["adj3", 25000]
  ],
  CURVED_RIGHT_ARROW: [
    ["adj1", 25000],
    ["adj2", 50000],
    ["adj3", 25000]
  ],
  CURVED_UP_ARROW: [
    ["adj1", 25000],
    ["adj2", 50000],
    ["adj3", 25000]
  ],
  CURVED_UP_RIBBON: [
    ["adj1", 25000],
    ["adj2", 50000],
    ["adj3", 12500]
  ],
  DECAGON: [["vf", 105146]],
  DIAGONAL_STRIPE: [["adj", 50000]],
  DONUT: [["adj", 25000]],
  DOUBLE_BRACE: [["adj", 8333]],
  DOUBLE_BRACKET: [["adj", 16667]],
  DOUBLE_WAVE: [
    ["adj1", 6250],
    ["adj2", 0]
  ],
  DOWN_ARROW: [
    ["adj1", 50000],
    ["adj2", 50000]
  ],
  DOWN_ARROW_CALLOUT: [
    ["adj1", 25000],
    ["adj2", 25000],
    ["adj3", 25000],
    ["adj4", 64977]
  ],
  DOWN_RIBBON: [
    ["adj1", 16667],
    ["adj2", 50000]
  ],
  FRAME: [["adj1", 12500]],
  GEAR_6: [
    ["adj1", 15000],
    ["adj2", 3526]
  ],
  GEAR_9: [
    ["adj1", 10000],
    ["adj2", 1763]
  ],
  HALF_FRAME: [
    ["adj1", 33333],
    ["adj2", 33333]
  ],
  HEPTAGON: [
    ["hf", 102572],
    ["vf", 105210]
  ],
  HEXAGON: [
    ["adj", 25000],
    ["vf", 115470]
  ],
  HORIZONTAL_SCROLL: [["adj", 12500]],
  ISOSCELES_TRIANGLE: [["adj", 50000]],
  LEFT_ARROW: [
    ["adj1", 50000],
    ["adj2", 50000]
  ],
  LEFT_ARROW_CALLOUT: [
    ["adj1", 25000],
    ["adj2", 25000],
    ["adj3", 25000],
    ["adj4", 64977]
  ],
  LEFT_BRACE: [
    ["adj1", 8333],
    ["adj2", 50000]
  ],
  LEFT_BRACKET: [["adj", 8333]],
  LEFT_CIRCULAR_ARROW: [
    ["adj1", 12500],
    ["adj2", -1142319],
    ["adj3", 1142319],
    ["adj4", 10800000],
    ["adj5", 12500]
  ],
  LEFT_RIGHT_ARROW: [
    ["adj1", 50000],
    ["adj2", 50000]
  ],
  LEFT_RIGHT_ARROW_CALLOUT: [
    ["adj1", 25000],
    ["adj2", 25000],
    ["adj3", 25000],
    ["adj4", 48123]
  ],
  LEFT_RIGHT_CIRCULAR_ARROW: [
    ["adj1", 12500],
    ["adj2", 1142319],
    ["adj3", 20457681],
    ["adj4", 11942319],
    ["adj5", 12500]
  ],
  LEFT_RIGHT_RIBBON: [
    ["adj1", 50000],
    ["adj2", 50000],
    ["adj3", 16667]
  ],
  LEFT_RIGHT_UP_ARROW: [
    ["adj1", 25000],
    ["adj2", 25000],
    ["adj3", 25000]
  ],
  LEFT_UP_ARROW: [
    ["adj1", 25000],
    ["adj2", 25000],
    ["adj3", 25000]
  ],
  LINE_CALLOUT_1: [
    ["adj1", 18750],
    ["adj2", -8333],
    ["adj3", 112500],
    ["adj4", -38333]
  ],
  LINE_CALLOUT_1_ACCENT_BAR: [
    ["adj1", 18750],
    ["adj2", -8333],
    ["adj3", 112500],
    ["adj4", -38333]
  ],
  LINE_CALLOUT_1_BORDER_AND_ACCENT_BAR: [
    ["adj1", 18750],
    ["adj2", -8333],
    ["adj3", 112500],
    ["adj4", -38333]
  ],
  LINE_CALLOUT_1_NO_BORDER: [
    ["adj1", 18750],
    ["adj2", -8333],
    ["adj3", 112500],
    ["adj4", -38333]
  ],
  LINE_CALLOUT_2: [
    ["adj1", 18750],
    ["adj2", -8333],
    ["adj3", 18750],
    ["adj4", -16667],
    ["adj5", 112500],
    ["adj6", -46667]
  ],
  LINE_CALLOUT_2_ACCENT_BAR: [
    ["adj1", 18750],
    ["adj2", -8333],
    ["adj3", 18750],
    ["adj4", -16667],
    ["adj5", 112500],
    ["adj6", -46667]
  ],
  LINE_CALLOUT_2_BORDER_AND_ACCENT_BAR: [
    ["adj1", 18750],
    ["adj2", -8333],
    ["adj3", 18750],
    ["adj4", -16667],
    ["adj5", 112500],
    ["adj6", -46667]
  ],
  LINE_CALLOUT_2_NO_BORDER: [
    ["adj1", 18750],
    ["adj2", -8333],
    ["adj3", 18750],
    ["adj4", -16667],
    ["adj5", 112500],
    ["adj6", -46667]
  ],
  LINE_CALLOUT_3: [
    ["adj1", 18750],
    ["adj2", -8333],
    ["adj3", 18750],
    ["adj4", -16667],
    ["adj5", 100000],
    ["adj6", -16667],
    ["adj7", 112963],
    ["adj8", -8333]
  ],
  LINE_CALLOUT_3_ACCENT_BAR: [
    ["adj1", 18750],
    ["adj2", -8333],
    ["adj3", 18750],
    ["adj4", -16667],
    ["adj5", 100000],
    ["adj6", -16667],
    ["adj7", 112963],
    ["adj8", -8333]
  ],
  LINE_CALLOUT_3_BORDER_AND_ACCENT_BAR: [
    ["adj1", 18750],
    ["adj2", -8333],
    ["adj3", 18750],
    ["adj4", -16667],
    ["adj5", 100000],
    ["adj6", -16667],
    ["adj7", 112963],
    ["adj8", -8333]
  ],
  LINE_CALLOUT_3_NO_BORDER: [
    ["adj1", 18750],
    ["adj2", -8333],
    ["adj3", 18750],
    ["adj4", -16667],
    ["adj5", 100000],
    ["adj6", -16667],
    ["adj7", 112963],
    ["adj8", -8333]
  ],
  LINE_CALLOUT_4: [
    ["adj1", 18750],
    ["adj2", -8333],
    ["adj3", 18750],
    ["adj4", -16667],
    ["adj5", 100000],
    ["adj6", -16667],
    ["adj7", 112963],
    ["adj8", -8333]
  ],
  LINE_CALLOUT_4_ACCENT_BAR: [
    ["adj1", 18750],
    ["adj2", -8333],
    ["adj3", 18750],
    ["adj4", -16667],
    ["adj5", 100000],
    ["adj6", -16667],
    ["adj7", 112963],
    ["adj8", -8333]
  ],
  LINE_CALLOUT_4_BORDER_AND_ACCENT_BAR: [
    ["adj1", 18750],
    ["adj2", -8333],
    ["adj3", 18750],
    ["adj4", -16667],
    ["adj5", 100000],
    ["adj6", -16667],
    ["adj7", 112963],
    ["adj8", -8333]
  ],
  LINE_CALLOUT_4_NO_BORDER: [
    ["adj1", 18750],
    ["adj2", -8333],
    ["adj3", 18750],
    ["adj4", -16667],
    ["adj5", 100000],
    ["adj6", -16667],
    ["adj7", 112963],
    ["adj8", -8333]
  ],
  MATH_DIVIDE: [
    ["adj1", 23520],
    ["adj2", 5880],
    ["adj3", 11760]
  ],
  MATH_EQUAL: [
    ["adj1", 23520],
    ["adj2", 11760]
  ],
  MATH_MINUS: [["adj1", 23520]],
  MATH_MULTIPLY: [["adj1", 23520]],
  MATH_NOT_EQUAL: [
    ["adj1", 23520],
    ["adj2", 6600000],
    ["adj3", 11760]
  ],
  MATH_PLUS: [["adj1", 23520]],
  MOON: [["adj", 50000]],
  NON_ISOSCELES_TRAPEZOID: [
    ["adj1", 25000],
    ["adj2", 25000]
  ],
  NOTCHED_RIGHT_ARROW: [
    ["adj1", 50000],
    ["adj2", 50000]
  ],
  NO_SYMBOL: [["adj", 18750]],
  OCTAGON: [["adj", 29289]],
  OVAL_CALLOUT: [
    ["adj1", -20833],
    ["adj2", 62500]
  ],
  PARALLELOGRAM: [["adj", 25000]],
  PENTAGON: [["adj", 50000]],
  PIE: [
    ["adj1", 0],
    ["adj2", 16200000]
  ],
  PLAQUE: [["adj", 16667]],
  QUAD_ARROW: [
    ["adj1", 22500],
    ["adj2", 22500],
    ["adj3", 22500]
  ],
  QUAD_ARROW_CALLOUT: [
    ["adj1", 18515],
    ["adj2", 18515],
    ["adj3", 18515],
    ["adj4", 48123]
  ],
  RECTANGULAR_CALLOUT: [
    ["adj1", -20833],
    ["adj2", 62500]
  ],
  REGULAR_PENTAGON: [
    ["hf", 105146],
    ["vf", 110557]
  ],
  RIGHT_ARROW: [
    ["adj1", 50000],
    ["adj2", 50000]
  ],
  RIGHT_ARROW_CALLOUT: [
    ["adj1", 25000],
    ["adj2", 25000],
    ["adj3", 25000],
    ["adj4", 64977]
  ],
  RIGHT_BRACE: [
    ["adj1", 8333],
    ["adj2", 50000]
  ],
  RIGHT_BRACKET: [["adj", 8333]],
  ROUNDED_RECTANGLE: [["adj", 16667]],
  ROUNDED_RECTANGULAR_CALLOUT: [
    ["adj1", -20833],
    ["adj2", 62500],
    ["adj3", 16667]
  ],
  ROUND_1_RECTANGLE: [["adj", 16667]],
  ROUND_2_DIAG_RECTANGLE: [
    ["adj1", 16667],
    ["adj2", 0]
  ],
  ROUND_2_SAME_RECTANGLE: [
    ["adj1", 16667],
    ["adj2", 0]
  ],
  SMILEY_FACE: [["adj", 4653]],
  SNIP_1_RECTANGLE: [["adj", 16667]],
  SNIP_2_DIAG_RECTANGLE: [
    ["adj1", 0],
    ["adj2", 16667]
  ],
  SNIP_2_SAME_RECTANGLE: [
    ["adj1", 16667],
    ["adj2", 0]
  ],
  SNIP_ROUND_RECTANGLE: [
    ["adj1", 16667],
    ["adj2", 16667]
  ],
  STAR_10_POINT: [
    ["adj", 42533],
    ["hf", 105146]
  ],
  STAR_12_POINT: [["adj", 37500]],
  STAR_16_POINT: [["adj", 37500]],
  STAR_24_POINT: [["adj", 37500]],
  STAR_32_POINT: [["adj", 37500]],
  STAR_4_POINT: [["adj", 12500]],
  STAR_5_POINT: [
    ["adj", 19098],
    ["hf", 105146],
    ["vf", 110557]
  ],
  STAR_6_POINT: [
    ["adj", 28868],
    ["hf", 115470]
  ],
  STAR_7_POINT: [
    ["adj", 34601],
    ["hf", 102572],
    ["vf", 105210]
  ],
  STAR_8_POINT: [["adj", 37500]],
  STRIPED_RIGHT_ARROW: [
    ["adj1", 50000],
    ["adj2", 50000]
  ],
  SUN: [["adj", 25000]],
  SWOOSH_ARROW: [
    ["adj1", 25000],
    ["adj2", 16667]
  ],
  TEAR: [["adj", 100000]],
  TRAPEZOID: [["adj", 25000]],
  UP_ARROW: [
    ["adj1", 50000],
    ["adj2", 50000]
  ],
  UP_ARROW_CALLOUT: [
    ["adj1", 25000],
    ["adj2", 25000],
    ["adj3", 25000],
    ["adj4", 64977]
  ],
  UP_DOWN_ARROW: [
    ["adj1", 50000],
    ["adj1", 50000],
    ["adj2", 50000],
    ["adj2", 50000]
  ],
  UP_DOWN_ARROW_CALLOUT: [
    ["adj1", 25000],
    ["adj2", 25000],
    ["adj3", 25000],
    ["adj4", 48123]
  ],
  UP_RIBBON: [
    ["adj1", 16667],
    ["adj2", 50000]
  ],
  U_TURN_ARROW: [
    ["adj1", 25000],
    ["adj2", 25000],
    ["adj3", 25000],
    ["adj4", 43750],
    ["adj5", 75000]
  ],
  VERTICAL_SCROLL: [["adj", 12500]],
  WAVE: [
    ["adj1", 12500],
    ["adj2", 0]
  ]
};
