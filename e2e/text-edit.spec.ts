import { expect, test, type Page } from "@playwright/test";

type PersistedPoint = {
  x?: number;
  y?: number;
};

type PersistedElement = {
  type?: string;
  text?: string;
  layer?: number;
  points?: PersistedPoint[];
  width?: number;
  height?: number;
  style?: {
    fill?: string;
    lineWidth?: number;
    stroke?: string;
  };
};

type PersistedViewport = {
  x?: number;
  y?: number;
  zoom?: number;
};

type PersistedScene = {
  elements?: PersistedElement[];
  viewport?: PersistedViewport;
};

type CanvasRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const TRANSPARENT_COLOR = "rgba(255, 255, 255, 0)";

const readPersistedScene = async (page: Page): Promise<PersistedScene | undefined> =>
  page.evaluate(
    () =>
      new Promise<PersistedScene | undefined>((resolve, reject) => {
        const request = indexedDB.open("sketchboard-db", 1);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction("scenes", "readonly");
          const store = transaction.objectStore("scenes");
          const getRequest = store.get("default-scene");

          getRequest.onerror = () => {
            database.close();
            reject(getRequest.error);
          };
          getRequest.onsuccess = () => {
            database.close();
            resolve(getRequest.result as PersistedScene | undefined);
          };
        };
      }),
  );

const readPersistedElements = async (page: Page): Promise<PersistedElement[]> => {
  const scene = await readPersistedScene(page);

  return scene?.elements ?? [];
};

const readPersistedViewport = async (page: Page): Promise<PersistedViewport | undefined> => {
  const scene = await readPersistedScene(page);

  return scene?.viewport;
};

const readPersistedZoom = async (page: Page): Promise<number> => {
  const viewport = await readPersistedViewport(page);

  return viewport?.zoom ?? 1;
};

const readPersistedTexts = async (page: Page): Promise<string[]> => {
  const elements = await readPersistedElements(page);

  return elements.filter((element) => element.type === "text").map((element) => element.text ?? "");
};

const readPersistedLayers = async (page: Page): Promise<number[]> => {
  const elements = await readPersistedElements(page);

  return elements.map((element) => element.layer ?? -1);
};

const expectActiveTool = async (page: Page, tool: string): Promise<void> => {
  await expect(page.locator(`.editor-tool-button[data-tool="${tool}"]`)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
};

const countDarkCanvasPixels = async (page: Page, region: CanvasRegion): Promise<number> =>
  page.locator("[data-canvas]").evaluate((element, currentRegion) => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext("2d");

    if (!context) {
      return 0;
    }

    const bounds = canvas.getBoundingClientRect();
    const scaleX = canvas.width / bounds.width;
    const scaleY = canvas.height / bounds.height;
    const image = context.getImageData(
      Math.round(currentRegion.x * scaleX),
      Math.round(currentRegion.y * scaleY),
      Math.round(currentRegion.width * scaleX),
      Math.round(currentRegion.height * scaleY),
    );
    let darkPixelCount = 0;

    for (let index = 0; index < image.data.length; index += 4) {
      const red = image.data[index] ?? 255;
      const green = image.data[index + 1] ?? 255;
      const blue = image.data[index + 2] ?? 255;
      const alpha = image.data[index + 3] ?? 0;

      if (alpha > 0 && red < 90 && green < 90 && blue < 90) {
        darkPixelCount += 1;
      }
    }

    return darkPixelCount;
  }, region);

const dragCanvas = async (
  page: Page,
  start: { x: number; y: number },
  end: { x: number; y: number },
): Promise<void> => {
  const canvasBox = await page.locator("[data-canvas]").boundingBox();

  expect(canvasBox).not.toBeNull();

  await page.mouse.move(canvasBox!.x + start.x, canvasBox!.y + start.y);
  await page.mouse.down();
  await page.mouse.move(canvasBox!.x + end.x, canvasBox!.y + end.y, { steps: 8 });
  await page.mouse.up();
};

const absoluteSize = (value: number | undefined): number => Math.abs(value ?? 0);

const setFillColor = async (page: Page, color: string): Promise<void> => {
  await page.locator(`[data-fill-color][data-color="${color}"]`).click();
};

const setStrokeColor = async (page: Page, color: string): Promise<void> => {
  await page.locator(`[data-stroke-color][data-color="${color}"]`).click();
};

const setStrokeWidth = async (page: Page, lineWidth: number): Promise<void> => {
  await page.locator(`[data-stroke-width][data-width="${lineWidth}"]`).click();
};

const wheelCanvas = async (
  page: Page,
  position: { x: number; y: number },
  deltaY: number,
): Promise<void> => {
  const canvas = page.locator("[data-canvas]");

  await canvas.hover({ position });
  await page.mouse.wheel(0, deltaY);
};

const dispatchTouchpadPinchWheel = async (
  page: Page,
  position: { x: number; y: number },
  deltaY: number,
): Promise<void> => {
  const canvas = page.locator("[data-canvas]");
  const canvasBox = await canvas.boundingBox();

  expect(canvasBox).not.toBeNull();
  await canvas.dispatchEvent("wheel", {
    bubbles: true,
    cancelable: true,
    clientX: canvasBox!.x + position.x,
    clientY: canvasBox!.y + position.y,
    ctrlKey: true,
    deltaY,
  });
};

const pinchCanvas = async (
  page: Page,
  start: { first: { x: number; y: number }; second: { x: number; y: number } },
  end: { first: { x: number; y: number }; second: { x: number; y: number } },
): Promise<void> => {
  const canvasBox = await page.locator("[data-canvas]").boundingBox();

  expect(canvasBox).not.toBeNull();

  const client = await page.context().newCDPSession(page);
  await client.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 2,
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { id: 1, x: canvasBox!.x + start.first.x, y: canvasBox!.y + start.first.y },
      { id: 2, x: canvasBox!.x + start.second.x, y: canvasBox!.y + start.second.y },
    ],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { id: 1, x: canvasBox!.x + end.first.x, y: canvasBox!.y + end.first.y },
      { id: 2, x: canvasBox!.x + end.second.x, y: canvasBox!.y + end.second.y },
    ],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await client.detach();
};

test("pans the canvas with the Pan tool without creating history entries", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Text" })).toBeVisible();

  await page.getByRole("button", { name: "Clear" }).click();
  await expect.poll(() => readPersistedElements(page)).toEqual([]);

  await page.keyboard.press("1");
  await expectActiveTool(page, "pan");
  await page.keyboard.press("2");
  await expectActiveTool(page, "select");
  await page.keyboard.press("8");
  await expectActiveTool(page, "arrow");

  const canvas = page.locator("[data-canvas]");
  const textEditor = page.locator("[data-text-editor]");

  await page.getByRole("button", { name: "Text" }).click();
  await canvas.click({ position: { x: 320, y: 260 } });
  await expect(textEditor).toBeVisible();
  await textEditor.fill("Pan target");
  await textEditor.press("Control+Enter");

  await expect.poll(() => readPersistedElements(page)).toHaveLength(1);
  await expect(page.locator("[data-object-settings-panel] [data-layer-panel]")).toBeVisible();

  const viewportBeforePan = await readPersistedViewport(page);

  await page.keyboard.press("1");
  await expectActiveTool(page, "pan");
  await dragCanvas(page, { x: 320, y: 260 }, { x: 390, y: 300 });

  await expect(canvas).toHaveAttribute("data-panning", "false");
  await expect.poll(() => readPersistedElements(page)).toHaveLength(1);
  await expect(page.locator("[data-object-settings-panel] [data-layer-panel]")).toBeVisible();
  await expect
    .poll(() => readPersistedViewport(page))
    .toMatchObject({
      x: (viewportBeforePan?.x ?? 0) + 70,
      y: (viewportBeforePan?.y ?? 0) + 40,
      zoom: viewportBeforePan?.zoom ?? 1,
    });

  await page.keyboard.press("Control+Z");

  await expect.poll(() => readPersistedElements(page)).toEqual([]);
  await expect
    .poll(() => readPersistedViewport(page))
    .toMatchObject({
      x: (viewportBeforePan?.x ?? 0) + 70,
      y: (viewportBeforePan?.y ?? 0) + 40,
      zoom: viewportBeforePan?.zoom ?? 1,
    });
});

test("shows toolbar shortcut digits and immediate tooltips", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Text" })).toBeVisible();

  const toolButtons = page.locator(".editor-tool-button");

  await expect(toolButtons).toHaveCount(8);
  await expect(page.locator(".editor-tool-button__shortcut")).toHaveText([
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
  ]);
  await expect(page.locator(".editor-tool-button[title]")).toHaveCount(0);

  const panTool = page.locator('.editor-tool-button[data-tool="pan"]');
  const tooltip = page.getByText("Pan (1, H)");

  await panTool.hover();
  await expect(tooltip).toBeVisible();

  await page.mouse.move(500, 500);
  await expect(tooltip).toBeHidden();

  await panTool.focus();
  await expect(tooltip).toBeVisible();
});

test("shows object settings for drawing tools and selected objects", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Text" })).toBeVisible();

  await page.getByRole("button", { name: "Clear" }).click();
  await expect.poll(() => readPersistedElements(page)).toEqual([]);

  const canvas = page.locator("[data-canvas]");
  const objectSettingsPanel = page.locator("[data-object-settings-panel]");
  const textEditor = page.locator("[data-text-editor]");

  await expectActiveTool(page, "select");
  await expect(objectSettingsPanel).toBeHidden();

  await page.keyboard.press("3");
  await expectActiveTool(page, "brush");
  await expect(objectSettingsPanel).toBeVisible();

  await page.keyboard.press("2");
  await expectActiveTool(page, "select");
  await expect(objectSettingsPanel).toBeHidden();

  await page.getByRole("button", { name: "Text" }).click();
  await expect(objectSettingsPanel).toBeVisible();
  await expect(objectSettingsPanel.locator('input[type="color"]')).toHaveCount(0);
  await expect(objectSettingsPanel.locator("[data-stroke-color]")).toHaveCount(7);
  await expect(objectSettingsPanel.locator("[data-fill-color]")).toHaveCount(7);
  await expect(
    objectSettingsPanel.getByRole("button", { name: "Stroke Transparent" }),
  ).toHaveAttribute("data-color", TRANSPARENT_COLOR);
  await expect(
    objectSettingsPanel.getByRole("button", { name: "Fill Transparent" }),
  ).toHaveAttribute("data-color", TRANSPARENT_COLOR);
  await expect(objectSettingsPanel.locator("[data-stroke-width]")).toHaveCount(3);
  await expect(
    objectSettingsPanel.locator('[data-stroke-width][aria-pressed="true"]'),
  ).toHaveAttribute("data-width", "2");
  await canvas.click({ position: { x: 320, y: 260 } });
  await expect(textEditor).toBeVisible();
  await textEditor.fill("Styled note");
  await textEditor.press("Control+Enter");

  await expectActiveTool(page, "select");
  await expect(objectSettingsPanel).toBeVisible();
  await expect.poll(() => readPersistedElements(page)).toHaveLength(1);

  await setStrokeColor(page, "#61746b");
  await setFillColor(page, "#e8f1ec");
  await setStrokeWidth(page, 4);

  await expect
    .poll(async () => {
      const [element] = await readPersistedElements(page);

      return element?.style;
    })
    .toMatchObject({
      stroke: "#61746b",
      fill: "#e8f1ec",
      lineWidth: 4,
    });

  await page.keyboard.press("5");
  await expectActiveTool(page, "rectangle");
  await dragCanvas(page, { x: 120, y: 130 }, { x: 220, y: 180 });
  await expectActiveTool(page, "select");

  await expect
    .poll(async () => {
      const elements = await readPersistedElements(page);
      const rectangle = elements.find((element) => element.type === "rectangle");

      return rectangle?.style?.lineWidth;
    })
    .toBe(4);

  await canvas.click({ position: { x: 170, y: 155 } });
  await expect(objectSettingsPanel).toBeVisible();

  await setStrokeColor(page, TRANSPARENT_COLOR);
  await setFillColor(page, TRANSPARENT_COLOR);

  await expect
    .poll(async () => {
      const elements = await readPersistedElements(page);
      const rectangle = elements.find((element) => element.type === "rectangle");

      return rectangle?.style;
    })
    .toMatchObject({
      stroke: TRANSPARENT_COLOR,
      fill: TRANSPARENT_COLOR,
    });
});

test("creates ellipses by default and circles when Shift is held", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Ellipse" })).toBeVisible();

  await page.getByRole("button", { name: "Clear" }).click();
  await expect.poll(() => readPersistedElements(page)).toEqual([]);

  await page.keyboard.press("7");
  await expectActiveTool(page, "ellipse");
  await page.keyboard.press("c");
  await expectActiveTool(page, "ellipse");

  await dragCanvas(page, { x: 220, y: 180 }, { x: 340, y: 240 });
  await expectActiveTool(page, "select");
  await expect.poll(() => readPersistedElements(page)).toHaveLength(1);

  const [ellipse] = await readPersistedElements(page);

  expect(ellipse?.type).toBe("ellipse");
  expect(absoluteSize(ellipse?.width)).toBeGreaterThan(absoluteSize(ellipse?.height));

  await page.keyboard.press("7");
  await expectActiveTool(page, "ellipse");
  await page.keyboard.down("Shift");
  await dragCanvas(page, { x: 360, y: 180 }, { x: 440, y: 230 });
  await page.keyboard.up("Shift");
  await expectActiveTool(page, "select");
  await expect.poll(() => readPersistedElements(page)).toHaveLength(2);

  const elements = await readPersistedElements(page);
  const shiftedEllipse = elements[1];

  expect(shiftedEllipse?.type).toBe("ellipse");
  expect(absoluteSize(shiftedEllipse?.width)).toBeCloseTo(absoluteSize(shiftedEllipse?.height));
});

test("creates rectangles by default and squares when Shift is held", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Rectangle" })).toBeVisible();

  await page.getByRole("button", { name: "Clear" }).click();
  await expect.poll(() => readPersistedElements(page)).toEqual([]);

  await page.keyboard.press("5");
  await expectActiveTool(page, "rectangle");
  await page.keyboard.press("s");
  await expectActiveTool(page, "rectangle");

  await dragCanvas(page, { x: 220, y: 180 }, { x: 340, y: 240 });
  await expectActiveTool(page, "select");
  await expect.poll(() => readPersistedElements(page)).toHaveLength(1);

  const [rectangle] = await readPersistedElements(page);

  expect(rectangle?.type).toBe("rectangle");
  expect(absoluteSize(rectangle?.width)).toBeGreaterThan(absoluteSize(rectangle?.height));

  await page.keyboard.press("5");
  await expectActiveTool(page, "rectangle");
  await page.keyboard.down("Shift");
  await dragCanvas(page, { x: 360, y: 180 }, { x: 440, y: 230 });
  await page.keyboard.up("Shift");
  await expectActiveTool(page, "select");
  await expect.poll(() => readPersistedElements(page)).toHaveLength(2);

  const elements = await readPersistedElements(page);
  const shiftedRectangle = elements[1];

  expect(shiftedRectangle?.type).toBe("rectangle");
  expect(absoluteSize(shiftedRectangle?.width)).toBeCloseTo(absoluteSize(shiftedRectangle?.height));
});

test("pans with the mouse wheel without creating history entries", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Text" })).toBeVisible();

  await page.getByRole("button", { name: "Clear" }).click();
  await expect.poll(() => readPersistedElements(page)).toEqual([]);

  const canvas = page.locator("[data-canvas]");
  const textEditor = page.locator("[data-text-editor]");

  await page.getByRole("button", { name: "Text" }).click();
  await canvas.click({ position: { x: 320, y: 260 } });
  await expect(textEditor).toBeVisible();
  await textEditor.fill("Zoom target");
  await textEditor.press("Control+Enter");
  await expect.poll(() => readPersistedElements(page)).toHaveLength(1);

  const viewportBeforeWheel = await readPersistedViewport(page);

  await wheelCanvas(page, { x: 320, y: 260 }, 180);

  await expect
    .poll(() => readPersistedViewport(page))
    .toMatchObject({
      x: viewportBeforeWheel?.x ?? 0,
      y: (viewportBeforeWheel?.y ?? 0) - 180,
      zoom: viewportBeforeWheel?.zoom ?? 1,
    });
  const viewportAfterWheel = await readPersistedViewport(page);

  await page.keyboard.press("Control+Z");

  await expect.poll(() => readPersistedElements(page)).toEqual([]);
  await expect
    .poll(() => readPersistedViewport(page))
    .toMatchObject({
      x: viewportAfterWheel?.x,
      y: viewportAfterWheel?.y,
      zoom: viewportAfterWheel?.zoom,
    });
});

test("zooms with modifier wheel without creating history entries", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Text" })).toBeVisible();

  await page.getByRole("button", { name: "Clear" }).click();
  await expect.poll(() => readPersistedElements(page)).toEqual([]);

  const canvas = page.locator("[data-canvas]");
  const textEditor = page.locator("[data-text-editor]");

  await page.getByRole("button", { name: "Text" }).click();
  await canvas.click({ position: { x: 320, y: 260 } });
  await expect(textEditor).toBeVisible();
  await textEditor.fill("Modifier zoom target");
  await textEditor.press("Control+Enter");
  await expect.poll(() => readPersistedElements(page)).toHaveLength(1);

  const zoomBeforeWheel = await readPersistedZoom(page);

  await dispatchTouchpadPinchWheel(page, { x: 320, y: 260 }, -180);

  await expect.poll(() => readPersistedZoom(page)).toBeGreaterThan(zoomBeforeWheel);
  const viewportAfterZoom = await readPersistedViewport(page);

  await page.keyboard.press("Control+Z");

  await expect.poll(() => readPersistedElements(page)).toEqual([]);
  await expect
    .poll(() => readPersistedViewport(page))
    .toMatchObject({
      x: viewportAfterZoom?.x,
      y: viewportAfterZoom?.y,
      zoom: viewportAfterZoom?.zoom,
    });
});

test("zooms with controls and keyboard shortcuts", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Text" })).toBeVisible();

  const canvas = page.locator("[data-canvas]");
  const zoomReset = page.locator("[data-zoom-reset]");

  await canvas.click({ position: { x: 420, y: 280 } });
  await expect(zoomReset).toHaveText("100%");

  await page.locator("[data-zoom-in]").click();
  await expect(zoomReset).toHaveText("120%");
  await expect.poll(() => readPersistedZoom(page)).toBeGreaterThan(1);

  await page.keyboard.press("Control+0");
  await expect(zoomReset).toHaveText("100%");
  await expect.poll(() => readPersistedZoom(page)).toBeCloseTo(1, 4);

  await page.keyboard.press("Control+=");
  await expect(zoomReset).toHaveText("120%");

  await page.keyboard.press("Control+-");
  await expect(zoomReset).toHaveText("100%");

  await page.locator("[data-zoom-out]").click();
  await expect(zoomReset).toHaveText("83%");
  await expect.poll(() => readPersistedZoom(page)).toBeLessThan(1);

  await page.locator("[data-zoom-reset]").click();
  await expect(zoomReset).toHaveText("100%");
});

test("zooms with touchpad pinch wheel and phone pinch gestures", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Text" })).toBeVisible();

  const touchpadZoomBefore = await readPersistedZoom(page);

  await dispatchTouchpadPinchWheel(page, { x: 360, y: 260 }, -140);
  await expect.poll(() => readPersistedZoom(page)).toBeGreaterThan(touchpadZoomBefore);

  await page.locator("[data-zoom-reset]").click();
  await expect.poll(() => readPersistedZoom(page)).toBeCloseTo(1, 4);

  await pinchCanvas(
    page,
    {
      first: { x: 280, y: 320 },
      second: { x: 360, y: 320 },
    },
    {
      first: { x: 230, y: 320 },
      second: { x: 410, y: 320 },
    },
  );

  await expect.poll(() => readPersistedZoom(page)).toBeGreaterThan(1);
});

test("creates and edits text after zooming", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Text" })).toBeVisible();

  await page.getByRole("button", { name: "Clear" }).click();
  await expect.poll(() => readPersistedElements(page)).toEqual([]);

  const canvas = page.locator("[data-canvas]");
  const textEditor = page.locator("[data-text-editor]");
  const textPoint = { x: 320, y: 260 };

  await page.locator("[data-zoom-in]").click();
  await expect.poll(() => readPersistedZoom(page)).toBeGreaterThan(1);

  await page.getByRole("button", { name: "Text" }).click();
  await canvas.click({ position: textPoint });
  await expect(textEditor).toBeVisible();
  await textEditor.fill("Zoomed note");
  await textEditor.press("Control+Enter");
  await expect.poll(() => readPersistedTexts(page)).toEqual(["Zoomed note"]);

  await canvas.dblclick({ position: { x: textPoint.x + 6, y: textPoint.y + 6 } });
  await expect(textEditor).toBeVisible();
  await expect(textEditor).toHaveValue("Zoomed note");
});

test("edits canvas text on double click", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Text" })).toBeVisible();

  await page.getByRole("button", { name: "Clear" }).click();
  await expect.poll(() => readPersistedElements(page)).toEqual([]);

  const canvas = page.locator("[data-canvas]");
  const textEditor = page.locator("[data-text-editor]");
  const textPoint = { x: 320, y: 260 };

  await page.getByRole("button", { name: "Text" }).click();
  await canvas.click({ position: textPoint });
  await expect(textEditor).toBeVisible();
  await textEditor.fill("Original note");
  await textEditor.press("Control+Enter");

  await expect.poll(() => readPersistedTexts(page)).toEqual(["Original note"]);
  await expectActiveTool(page, "select");
  const textRegion = { x: textPoint.x, y: textPoint.y, width: 180, height: 42 };
  const renderedTextPixels = await countDarkCanvasPixels(page, textRegion);

  expect(renderedTextPixels).toBeGreaterThan(100);

  await page.getByRole("button", { name: "Select" }).click();
  await canvas.dblclick({ position: { x: textPoint.x + 6, y: textPoint.y + 6 } });
  await expect(textEditor).toBeVisible();
  await expect(textEditor).toHaveValue("Original note");
  const editorBox = await textEditor.boundingBox();

  expect(editorBox?.x).toBeCloseTo(textPoint.x, 0);
  expect(editorBox?.y).toBeCloseTo(textPoint.y - 2, 0);
  await expect
    .poll(() => countDarkCanvasPixels(page, textRegion))
    .toBeLessThan(renderedTextPixels * 0.25);

  await textEditor.press("Escape");
  await expect(textEditor).toBeHidden();
  await expect.poll(() => readPersistedTexts(page)).toEqual(["Original note"]);
  await expect
    .poll(() => countDarkCanvasPixels(page, textRegion))
    .toBeGreaterThan(renderedTextPixels * 0.75);

  await canvas.dblclick({ position: { x: textPoint.x + 6, y: textPoint.y + 6 } });
  await expect(textEditor).toBeVisible();
  await expect(textEditor).toHaveValue("Original note");

  await textEditor.fill("Edited note");
  await textEditor.press("Control+Enter");

  await expect.poll(() => readPersistedTexts(page)).toEqual(["Edited note"]);
});

test("selects every canvas object with Control+A", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Text" })).toBeVisible();

  await page.getByRole("button", { name: "Clear" }).click();
  await expect.poll(() => readPersistedElements(page)).toEqual([]);

  const canvas = page.locator("[data-canvas]");
  const textEditor = page.locator("[data-text-editor]");

  await page.getByRole("button", { name: "Text" }).click();
  await canvas.click({ position: { x: 300, y: 230 } });
  await expect(textEditor).toBeVisible();
  await textEditor.fill("Select all note");
  await textEditor.press("Control+Enter");

  await page.getByRole("button", { name: "Rectangle" }).click();
  await dragCanvas(page, { x: 260, y: 300 }, { x: 420, y: 380 });
  await expect.poll(() => readPersistedElements(page)).toHaveLength(2);
  await expectActiveTool(page, "select");

  await page.keyboard.press("Control+A");
  await expect(page.locator("[data-object-settings-panel] [data-layer-panel]")).toBeVisible();

  await page.keyboard.press("Delete");

  await expect.poll(() => readPersistedElements(page)).toEqual([]);
});

test("selects through unfilled rectangle interiors and respects filled ones", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Text" })).toBeVisible();

  await page.getByRole("button", { name: "Clear" }).click();
  await expect.poll(() => readPersistedElements(page)).toEqual([]);

  const canvas = page.locator("[data-canvas]");
  const textEditor = page.locator("[data-text-editor]");
  const textPoint = { x: 330, y: 265 };

  await page.getByRole("button", { name: "Text" }).click();
  await canvas.click({ position: textPoint });
  await expect(textEditor).toBeVisible();
  await textEditor.fill("Inner label");
  await textEditor.press("Control+Enter");
  await expect.poll(() => readPersistedTexts(page)).toEqual(["Inner label"]);

  await page.getByRole("button", { name: "Rectangle" }).click();
  await dragCanvas(page, { x: 280, y: 220 }, { x: 560, y: 360 });
  await expect.poll(() => readPersistedElements(page)).toHaveLength(2);
  await expectActiveTool(page, "select");

  await page.getByRole("button", { name: "Select" }).click();
  await canvas.click({ position: { x: textPoint.x + 8, y: textPoint.y + 8 } });
  await page.keyboard.press("Delete");

  await expect.poll(() => readPersistedElements(page)).toMatchObject([{ type: "rectangle" }]);
  await expect.poll(() => readPersistedTexts(page)).toEqual([]);

  await page.getByRole("button", { name: "Clear" }).click();
  await expect.poll(() => readPersistedElements(page)).toEqual([]);

  await page.getByRole("button", { name: "Text" }).click();
  await canvas.click({ position: textPoint });
  await expect(textEditor).toBeVisible();
  await textEditor.fill("Covered label");
  await textEditor.press("Control+Enter");
  await expect.poll(() => readPersistedTexts(page)).toEqual(["Covered label"]);

  await setFillColor(page, "#ffffff");
  await page.getByRole("button", { name: "Rectangle" }).click();
  await dragCanvas(page, { x: 280, y: 220 }, { x: 560, y: 360 });
  await expect.poll(() => readPersistedElements(page)).toHaveLength(2);
  await expectActiveTool(page, "select");

  await page.getByRole("button", { name: "Select" }).click();
  await canvas.click({ position: { x: textPoint.x + 8, y: textPoint.y + 8 } });
  await page.keyboard.press("Delete");

  await expect.poll(() => readPersistedTexts(page)).toEqual(["Covered label"]);
  await expect.poll(() => readPersistedElements(page)).toMatchObject([{ type: "text" }]);
});

test("bends arrows by dragging their middle point", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Text" })).toBeVisible();

  await page.getByRole("button", { name: "Clear" }).click();
  await expect.poll(() => readPersistedElements(page)).toEqual([]);

  const canvas = page.locator("[data-canvas]");

  await page.getByRole("button", { name: "Arrow" }).click();
  await dragCanvas(page, { x: 300, y: 260 }, { x: 500, y: 260 });
  await expect
    .poll(() => readPersistedElements(page))
    .toMatchObject([
      {
        type: "arrow",
        points: [
          { x: 300, y: 260 },
          { x: 400, y: 260 },
          { x: 500, y: 260 },
        ],
      },
    ]);
  await expectActiveTool(page, "select");

  await page.getByRole("button", { name: "Select" }).click();
  await canvas.click({ position: { x: 400, y: 260 } });
  await dragCanvas(page, { x: 400, y: 260 }, { x: 400, y: 180 });

  await expect
    .poll(() => readPersistedElements(page))
    .toMatchObject([
      {
        type: "arrow",
        points: [
          { x: 300, y: 260 },
          { x: 400, y: 180 },
          { x: 500, y: 260 },
        ],
      },
    ]);
  await expect
    .poll(() => countDarkCanvasPixels(page, { x: 388, y: 168, width: 24, height: 24 }))
    .toBeGreaterThan(8);
});

test("places multi-point arrows with clicks and finishes on the last point", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Text" })).toBeVisible();

  await page.getByRole("button", { name: "Clear" }).click();
  await expect.poll(() => readPersistedElements(page)).toEqual([]);

  const canvas = page.locator("[data-canvas]");

  await page.getByRole("button", { name: "Arrow" }).click();
  await canvas.click({ position: { x: 280, y: 260 } });
  await canvas.click({ position: { x: 340, y: 200 } });
  await canvas.click({ position: { x: 420, y: 250 } });
  await canvas.click({ position: { x: 500, y: 210 } });
  await expect.poll(() => readPersistedElements(page)).toEqual([]);
  await canvas.click({ position: { x: 500, y: 210 } });

  await expect
    .poll(() => readPersistedElements(page))
    .toMatchObject([
      {
        type: "arrow",
        points: [
          { x: 280, y: 260 },
          { x: 340, y: 200 },
          { x: 420, y: 250 },
          { x: 500, y: 210 },
        ],
      },
    ]);
  await expectActiveTool(page, "select");
});

test("moves selected elements with the left layer panel", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Text" })).toBeVisible();

  await page.getByRole("button", { name: "Clear" }).click();
  await expect.poll(() => readPersistedElements(page)).toEqual([]);

  const canvas = page.locator("[data-canvas]");
  const textEditor = page.locator("[data-text-editor]");
  const textPoint = { x: 330, y: 265 };

  await page.getByRole("button", { name: "Text" }).click();
  await canvas.click({ position: textPoint });
  await expect(textEditor).toBeVisible();
  await textEditor.fill("Layer label");
  await textEditor.press("Control+Enter");

  await setFillColor(page, "#ffffff");
  await page.getByRole("button", { name: "Rectangle" }).click();
  await dragCanvas(page, { x: 280, y: 220 }, { x: 560, y: 360 });
  await expect.poll(() => readPersistedLayers(page)).toEqual([0, 1]);
  await expectActiveTool(page, "select");

  await page.getByRole("button", { name: "Select" }).click();
  await canvas.click({ position: { x: textPoint.x + 8, y: textPoint.y + 8 } });

  const objectSettingsPanel = page.locator("[data-object-settings-panel]");
  const layerPanel = objectSettingsPanel.locator("[data-layer-panel]");

  await expect(layerPanel).toBeVisible();
  await expect(page.locator(".canvas-frame > [data-layer-panel]")).toHaveCount(0);
  await expect(layerPanel.getByRole("button", { name: "Назад", exact: true })).toBeVisible();
  await layerPanel.getByRole("button", { name: "Назад", exact: true }).click();
  await expect.poll(() => readPersistedLayers(page)).toEqual([1, 0]);

  await layerPanel.getByRole("button", { name: "Вперёд", exact: true }).click();
  await expect.poll(() => readPersistedLayers(page)).toEqual([0, 1]);

  await layerPanel.getByRole("button", { name: "Полностью назад" }).click();
  await expect.poll(() => readPersistedLayers(page)).toEqual([1, 0]);

  await layerPanel.getByRole("button", { name: "Полностью вперёд" }).click();
  await expect.poll(() => readPersistedLayers(page)).toEqual([0, 1]);
});
