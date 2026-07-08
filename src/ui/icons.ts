import type { Tool } from "../domain/elements";

type IconName =
  Tool | "clear" | "export" | "layerBackward" | "layerForward" | "layerToBack" | "layerToFront";

const icons: Record<IconName, string> = {
  select: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3l12 9-6 1.2L8 20 5 3Z"/></svg>',
  brush:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20c3.9 0 5.7-1.2 5.7-3.8 0-1.4-1.1-2.5-2.5-2.5C4.6 13.7 4 15.8 4 20Z"/><path d="m9.4 14.1 8.9-8.9a1.9 1.9 0 0 1 2.7 2.7l-8.9 8.9"/></svg>',
  text: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6V4h16v2"/><path d="M12 4v16"/><path d="M8 20h8"/></svg>',
  square:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="6" width="14" height="12" rx="1.5"/></svg>',
  diamond: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 9 9-9 9-9-9 9-9Z"/></svg>',
  circle: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"/></svg>',
  arrow:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15"/><path d="m13 6 6 6-6 6"/></svg>',
  clear:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14"/><path d="M9 7V5h6v2"/><path d="M8 10v8"/><path d="M12 10v8"/><path d="M16 10v8"/><path d="M7 7l1 14h8l1-14"/></svg>',
  export:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>',
  layerBackward:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5h9v9"/><path d="M5 8h9v9H5z"/><path d="m17 17 3 3 3-3"/><path d="M20 12v8"/></svg>',
  layerForward:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5h9v9"/><path d="M5 8h9v9H5z"/><path d="m17 7 3-3 3 3"/><path d="M20 4v8"/></svg>',
  layerToFront:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h9v9"/><path d="M5 9h9v9H5z"/><path d="M19 4h4"/><path d="m18 10 3-3 3 3"/><path d="M21 7v8"/></svg>',
  layerToBack:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h9v9"/><path d="M5 9h9v9H5z"/><path d="M19 20h4"/><path d="m18 14 3 3 3-3"/><path d="M21 9v8"/></svg>',
};

export const getIcon = (name: IconName): string => icons[name];
