import {
  DEFAULT_LAYER,
  DEFAULT_VIEWPORT,
  type DrawingElement,
  type SceneSnapshot,
} from "./elements";

const finiteOrDefault = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const normalizeElement = (
  element: DrawingElement | Record<string, unknown>,
  layerFallback: number,
): DrawingElement => {
  const migratedElement =
    element.type === "rectangle"
      ? { ...element, type: "square" }
      : element.type === "ellipse"
        ? { ...element, type: "circle" }
        : element;

  return {
    ...migratedElement,
    layer: finiteOrDefault(migratedElement.layer, layerFallback),
  } as DrawingElement;
};

const normalizeElements = (elements: Array<DrawingElement | Record<string, unknown>>) => {
  let nextLayer = DEFAULT_LAYER;

  return elements.map((element) => {
    const normalizedElement = normalizeElement(element, nextLayer);
    nextLayer = Math.max(nextLayer, normalizedElement.layer + 1);

    return normalizedElement;
  });
};

export const createEmptyScene = (): SceneSnapshot => ({
  version: 1,
  elements: [],
  viewport: { ...DEFAULT_VIEWPORT },
  updatedAt: Date.now(),
});

export const normalizeScene = (scene: Partial<SceneSnapshot> | null | undefined): SceneSnapshot => {
  if (!scene || scene.version !== 1 || !Array.isArray(scene.elements)) {
    return createEmptyScene();
  }

  const viewport = scene.viewport;

  return {
    version: 1,
    elements: normalizeElements(scene.elements as Array<Record<string, unknown>>),
    viewport: {
      x: finiteOrDefault(viewport?.x, DEFAULT_VIEWPORT.x),
      y: finiteOrDefault(viewport?.y, DEFAULT_VIEWPORT.y),
      zoom: finiteOrDefault(viewport?.zoom, DEFAULT_VIEWPORT.zoom),
    },
    updatedAt: finiteOrDefault(scene.updatedAt, Date.now()),
  };
};
