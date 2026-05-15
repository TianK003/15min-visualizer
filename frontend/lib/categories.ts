// Single source of truth for the 8 score categories. Anything that renders
// a category name, icon, or color (Scorecard rows, amenities list dots,
// path-to-amenity PathLayer) imports from here.

export type CategoryId =
  | "trgovina"
  | "izobrazevanje"
  | "zdravstvo"
  | "park"
  | "promet"
  | "sport"
  | "storitve"
  | "delo";

export type Category = {
  id: CategoryId;
  label: string;
  icon: string;
  /** Solid RGB triple — used for the category dot AND the route PathLayer. */
  color: [number, number, number];
  /** One-sentence Slovenian description, surfaced in the Scorecard expansion. */
  description: string;
};

export const CATEGORIES: readonly Category[] = [
  { id: "trgovina",       label: "Trgovina",       icon: "🛒", color: [245, 158, 11],  description: "Pokriva supermarkete, trgovine z dnevnimi dobrinami in pekarne." },
  { id: "izobrazevanje",  label: "Izobraževanje",  icon: "🎓", color: [59, 130, 246],  description: "Pokriva vrtce, osnovne in srednje šole ter fakultete." },
  { id: "zdravstvo",      label: "Zdravstvo",      icon: "⚕️", color: [239, 68, 68],   description: "Pokriva zdravstvene domove, klinike, lekarne in bolnišnice." },
  { id: "park",           label: "Park",           icon: "🌳", color: [34, 197, 94],   description: "Pokriva javne parke in mestne zelene površine." },
  { id: "promet",         label: "Javni promet",   icon: "🚌", color: [6, 182, 212],   description: "Pokriva avtobusne in vlakovne postaje ter postajališča javnega prometa." },
  { id: "sport",          label: "Šport",          icon: "🏟️", color: [168, 85, 247],  description: "Pokriva športne dvorane, igrišča in stadione." },
  { id: "storitve",       label: "Storitve",       icon: "✂️", color: [236, 72, 153],  description: "Pokriva pošto, banke, frizerje in restavracije." },
  { id: "delo",           label: "Delo",           icon: "💼", color: [107, 114, 128], description: "Pokriva pisarne in delovna mesta." },
] as const;

export const CATEGORY_IDS: CategoryId[] = CATEGORIES.map((c) => c.id);

export function categoryAt(index: number): Category {
  return CATEGORIES[index];
}

export function categoryById(id: CategoryId): Category | undefined {
  return CATEGORIES.find((c) => c.id === id);
}
