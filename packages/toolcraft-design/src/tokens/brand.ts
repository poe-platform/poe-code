export interface Brand {
  name: string;
  primary: string;
}

export const brands: Record<string, Brand> = {
  purple: { name: "purple", primary: "#a200ff" },
  blue: { name: "blue", primary: "#2f6fed" },
  green: { name: "green", primary: "#1f9d57" }
};
