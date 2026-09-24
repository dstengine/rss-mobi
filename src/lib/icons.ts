// Line icons: 24x24 stroke paths, drawn round-capped at stroke 2. The home,
// tag and newspaper marks are the DST network's own
// (dst_draft/packages/ui/src/icons.ts), so the sites read as one family;
// the rest are drawn to match. One name per meaning: a button and a menu
// item that do the same thing show the same mark. No imports, so the page
// scripts can draw them too.
export const ICONS = {
  home: "M3 10.5 12 3l9 7.5M5.5 9v11h13V9",
  topics: "M3 12V4h8l9 9-8 8-9-9ZM7.5 7.5h.01",
  reader: "M4 4h13a2 2 0 0 1 2 2v13a1 1 0 0 1-1 1H6a2 2 0 0 1-2-2V4ZM4 4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2M8 8h8M8 12h8M8 16h4",
  plus: "M12 5v14M5 12h14",
  check: "M5 12.5 9.5 17 19 7",
  combine: "M12 3 3 7.5l9 4.5 9-4.5L12 3ZM3 12l9 4.5 9-4.5M3 16.5 12 21l9-4.5",
  about: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18ZM12 11v5.5M12 7.5h.01",
  search: "M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13ZM20 20l-4.8-4.8",
  copy: "M9 9h11v11H9zM15 9V4H4v11h5",
  external: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
  import: "M12 4v11M7.5 10.5 12 15l4.5-4.5M4 15v5h16v-5",
  export: "M12 15V4M7.5 8.5 12 4l4.5 4.5M4 15v5h16v-5",
  minus: "M5 12h14",
} as const;

export type IconName = keyof typeof ICONS;
