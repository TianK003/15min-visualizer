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
  /** SVG path "d" attribute. Render inside an <svg viewBox="0 0 24 24"
   *  fill="currentColor">. Monochrome (no per-icon color); the icon picks up
   *  the surrounding text color so it works in both light and dark themes. */
  iconPath: string;
  /** Solid RGB triple — used for the category dot AND the route PathLayer. */
  color: [number, number, number];
  /** One-sentence Slovenian description, surfaced in the Scorecard expansion. */
  description: string;
};

// Shared 24×24 viewBox. Hand-crafted to read at 16–20 px UI sizes and at the
// larger sizes used in the suggestion tooltip + investor filter pills. The
// designs are filled silhouettes — no thin strokes — so they survive
// downscaling on retina displays.

const ICON_CART =
  "M3 3a1 1 0 000 2h1.34l2.36 12.18A2 2 0 008.66 19H19a1 1 0 000-2H8.66l-.39-2H18a2 2 0 001.95-1.55l1.5-6.5A1 1 0 0020.5 6H6.42l-.45-2.27A1 1 0 005 3H3zm5 18a2 2 0 100 4 2 2 0 000-4zm10 0a2 2 0 100 4 2 2 0 000-4z";

const ICON_GRAD_CAP =
  "M12 3L1 8l4 1.82V14.5c0 .15.04.3.12.43C6.4 17.2 9.07 18 12 18s5.6-.8 6.88-3.07c.08-.13.12-.28.12-.43V9.82L21 9v5a1 1 0 002 0V8L12 3zM7 10.73l5 2.27 5-2.27v3.27c-.93 1.27-2.93 1.83-5 1.83s-4.07-.56-5-1.83v-3.27z";

const ICON_MEDICAL_CROSS =
  "M9 3a1 1 0 00-1 1v4H4a1 1 0 00-1 1v6a1 1 0 001 1h4v4a1 1 0 001 1h6a1 1 0 001-1v-4h4a1 1 0 001-1V9a1 1 0 00-1-1h-4V4a1 1 0 00-1-1H9z";

const ICON_TREE =
  "M12 2L7.5 9H10L5 16h3.5L5 21h14l-3.5-5H19l-5-7h2.5L12 2zm-1 19h2v2h-2v-2z";

const ICON_BUS =
  "M6 3a3 3 0 00-3 3v11c0 .82.4 1.55 1 2v2a1 1 0 001 1h1a1 1 0 001-1v-1h10v1a1 1 0 001 1h1a1 1 0 001-1v-2c.6-.45 1-1.18 1-2V6a3 3 0 00-3-3H6zm1 5h10v3.5H7V8zm1.5 6a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm7 0a1.5 1.5 0 110 3 1.5 1.5 0 010-3z";

const ICON_TROPHY =
  "M8 3a1 1 0 00-1 1v1H4a1 1 0 00-1 1c0 2.7 1.7 4.95 4.27 5.7C7.97 13.32 9.27 14.55 11 15v2H9a2 2 0 00-2 2v2a1 1 0 001 1h8a1 1 0 001-1v-2a2 2 0 00-2-2h-2v-2c1.73-.45 3.03-1.68 3.73-3.3C19.3 10.95 21 8.7 21 6a1 1 0 00-1-1h-3V4a1 1 0 00-1-1H8zM5 7h2c.06 1.18.28 2.3.6 3.27C6.3 9.78 5.27 8.55 5 7zm14 0h-2c-.06 1.18-.28 2.3-.6 3.27C17.7 9.78 18.73 8.55 19 7z";

const ICON_SCISSORS =
  "M6 3a3 3 0 100 6 3 3 0 000-6zm0 2a1 1 0 110 2 1 1 0 010-2zM21 4l-10.5 7 1.4 1L21 6V4zM6 15a3 3 0 100 6 3 3 0 000-6zm0 2a1 1 0 110 2 1 1 0 010-2zm15 1l-9.4-7-1.4 1L21 20v-2zM12 11l1 .7 1-.7-1-.7-1 .7z";

const ICON_BRIEFCASE =
  "M10 3a1 1 0 00-1 1v2H5a2 2 0 00-2 2v3h18V8a2 2 0 00-2-2h-4V4a1 1 0 00-1-1h-4zm1 2h2v1h-2V5zM3 12v6a2 2 0 002 2h14a2 2 0 002-2v-6h-9v1a1 1 0 11-2 0v-1H3z";

export const ICON_HOME =
  "M12 3L2 12h3v8a1 1 0 001 1h4v-6h4v6h4a1 1 0 001-1v-8h3L12 3z";

export const CATEGORIES: readonly Category[] = [
  { id: "trgovina",       label: "Trgovina",       iconPath: ICON_CART,           color: [245, 158, 11],  description: "Pokriva supermarkete, trgovine z dnevnimi dobrinami in pekarne." },
  { id: "izobrazevanje",  label: "Izobraževanje",  iconPath: ICON_GRAD_CAP,       color: [59, 130, 246],  description: "Pokriva vrtce, osnovne in srednje šole ter fakultete." },
  { id: "zdravstvo",      label: "Zdravstvo",      iconPath: ICON_MEDICAL_CROSS,  color: [239, 68, 68],   description: "Pokriva zdravstvene domove, klinike, lekarne in bolnišnice." },
  { id: "park",           label: "Park",           iconPath: ICON_TREE,           color: [34, 197, 94],   description: "Pokriva javne parke in mestne zelene površine." },
  { id: "promet",         label: "Javni promet",   iconPath: ICON_BUS,            color: [6, 182, 212],   description: "Pokriva avtobusne in vlakovne postaje ter postajališča javnega prometa." },
  { id: "sport",          label: "Šport",          iconPath: ICON_TROPHY,         color: [168, 85, 247],  description: "Pokriva športne dvorane, igrišča in stadione." },
  { id: "storitve",       label: "Storitve",       iconPath: ICON_SCISSORS,       color: [236, 72, 153],  description: "Pokriva pošto, banke, frizerje in restavracije." },
  { id: "delo",           label: "Delo",           iconPath: ICON_BRIEFCASE,      color: [107, 114, 128], description: "Pokriva pisarne in delovna mesta." },
] as const;

export const CATEGORY_IDS: CategoryId[] = CATEGORIES.map((c) => c.id);

export function categoryAt(index: number): Category {
  return CATEGORIES[index];
}

export function categoryById(id: CategoryId): Category | undefined {
  return CATEGORIES.find((c) => c.id === id);
}
