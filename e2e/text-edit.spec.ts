import { expect, test, type Page } from "@playwright/test";

type PersistedPoint = {
  x?: number;
  y?: number;
};

type PersistedElement = {
  type?: string;
  text?: string;
  textAlign?: string;
  layer?: number;
  points?: PersistedPoint[];
  width?: number;
  height?: number;
  style?: {
    borderRadius?: 0 | 4 | 8 | 16;
    fill?: string;
    lineWidth?: number;
    opacity?: number;
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

type CanvasPixelBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
};

type TextEditorVisualMetrics = {
  fontSize: number;
  scale: number;
  visualFontSize: number;
};

type TextEditorLineMetrics = {
  backgroundColor: string;
  borderTopWidth: string;
  clientHeight: number;
  fontFamily: string;
  lineHeight: string;
  scrollHeight: number;
  whiteSpace: string;
  wrap: string | null;
};

const LONG_UNINTERRUPTED_TEXT = "123456789123456789123456789123456789";
const TEXT_LINE_HEIGHT = 1.3;
const TEXT_RENDERER_HORIZONTAL_INSET = 6;
const TRANSPARENT_COLOR = "rgba(255, 255, 255, 0)";
const OPAQUE_FILL_COLOR = "#f3f0e8";

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

const readTextEditorVisualMetrics = async (page: Page): Promise<TextEditorVisualMetrics> =>
  page.locator("[data-text-editor]").evaluate((element) => {
    const style = window.getComputedStyle(element);
    const transform =
      style.transform === "none" ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(style.transform);
    const fontSize = Number.parseFloat(style.fontSize);

    return {
      fontSize,
      scale: transform.a,
      visualFontSize: fontSize * transform.a,
    };
  });

const readTextEditorLineMetrics = async (page: Page): Promise<TextEditorLineMetrics> =>
  page.locator("[data-text-editor]").evaluate((element) => {
    const textarea = element as HTMLTextAreaElement;
    const style = window.getComputedStyle(textarea);

    return {
      backgroundColor: style.backgroundColor,
      borderTopWidth: style.borderTopWidth,
      clientHeight: textarea.clientHeight,
      fontFamily: style.fontFamily,
      lineHeight: style.lineHeight,
      scrollHeight: textarea.scrollHeight,
      whiteSpace: style.whiteSpace,
      wrap: textarea.getAttribute("wrap"),
    };
  });

const expectTextEditorToStayOnOneVisualLine = async (
  page: Page,
  shouldWrap = false,
): Promise<void> => {
  const metrics = await readTextEditorLineMetrics(page);

  expect(metrics.backgroundColor).toBe("rgba(0, 0, 0, 0)");
  expect(metrics.borderTopWidth).toBe("0px");
  expect(metrics.fontFamily).toContain("Comic Sans MS");
  expect(Number.parseFloat(metrics.lineHeight)).toBeCloseTo(24 * TEXT_LINE_HEIGHT, 1);
  expect(metrics.wrap).toBe(shouldWrap ? "soft" : "off");
  expect(metrics.whiteSpace).toBe(shouldWrap ? "pre-wrap" : "pre");
  expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight + 2);
};

const measureCanvasTextWidth = async (page: Page, text: string, fontSize = 24): Promise<number> =>
  page.locator("[data-canvas]").evaluate(
    (element, options) => {
      const canvas = element as HTMLCanvasElement;
      const context = canvas.getContext("2d");

      if (!context) {
        return 0;
      }

      context.font = `${options.fontSize}px "Virgil", "Comic Sans MS", "Segoe Print", sans-serif`;

      return context.measureText(options.text).width;
    },
    { text, fontSize },
  );

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

const readDarkCanvasPixelBounds = async (
  page: Page,
  region: CanvasRegion,
): Promise<CanvasPixelBounds | undefined> =>
  page.locator("[data-canvas]").evaluate((element, currentRegion) => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext("2d");

    if (!context) {
      return undefined;
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
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const index = (y * image.width + x) * 4;
        const red = image.data[index] ?? 255;
        const green = image.data[index + 1] ?? 255;
        const blue = image.data[index + 2] ?? 255;
        const alpha = image.data[index + 3] ?? 0;

        if (alpha > 0 && red < 90 && green < 90 && blue < 90) {
          minX = Math.min(minX, x / scaleX);
          minY = Math.min(minY, y / scaleY);
          maxX = Math.max(maxX, x / scaleX);
          maxY = Math.max(maxY, y / scaleY);
        }
      }
    }

    if (!Number.isFinite(minX)) {
      return undefined;
    }

    return {
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX,
      height: maxY - minY,
    };
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

const setBorderRadius = async (page: Page, borderRadius: 0 | 4 | 8 | 16): Promise<void> => {
  await page.locator(`[data-border-radius][data-radius="${borderRadius}"]`).click();
};

const setOpacity = async (page: Page, opacityPercent: number): Promise<void> => {
  const track = page.locator('[data-opacity-control] [data-slot="slider-track"]');
  const trackBox = await track.boundingBox();

  expect(trackBox).not.toBeNull();

  await page.mouse.click(
    trackBox!.x + (trackBox!.width * opacityPercent) / 100,
    trackBox!.y + trackBox!.height / 2,
  );
  await expect(page.locator("[data-opacity-value]")).toHaveText(`${opacityPercent}%`);
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

const zoomOutToMinimum = async (page: Page): Promise<number> => {
  for (let index = 0; index < 12; index += 1) {
    await page.locator("[data-zoom-out]").click();
  }

  await expect.poll(() => readPersistedZoom(page)).toBeCloseTo(0.25, 4);

  return readPersistedZoom(page);
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

test("restores the saved scene and viewport without restoring selection history", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Text" })).toBeVisible();

  await page.getByRole("button", { name: "Clear" }).click();
  await expect.poll(() => readPersistedElements(page)).toEqual([]);

  const canvas = page.locator("[data-canvas]");
  const textEditor = page.locator("[data-text-editor]");

  await page.getByRole("button", { name: "Text" }).click();
  await canvas.click({ position: { x: 320, y: 260 } });
  await textEditor.fill("Reloaded note");
  await textEditor.press("Control+Enter");
  await expect.poll(() => readPersistedTexts(page)).toEqual(["Reloaded note"]);
  await expect(page.locator("[data-selection-actions]")).toBeVisible();

  await wheelCanvas(page, { x: 320, y: 260 }, 120);
  await expect(page.locator("[data-save-state]")).toHaveAttribute("data-state", "saved");

  const viewportBeforeReload = await readPersistedViewport(page);

  expect(viewportBeforeReload).toBeDefined();
  expect(viewportBeforeReload?.y).not.toBe(0);
  await page.reload();

  await expect(page.getByRole("button", { name: "Text" })).toBeVisible();
  await expect.poll(() => readPersistedTexts(page)).toEqual(["Reloaded note"]);
  await expect.poll(() => readPersistedViewport(page)).toEqual(viewportBeforeReload);
  await expect(page.locator("[data-selection-actions]")).toBeHidden();
  await expect
    .poll(() =>
      countDarkCanvasPixels(page, {
        x: 0,
        y: 0,
        width: 1000,
        height: 700,
      }),
    )
    .toBeGreaterThan(0);

  await page.keyboard.press("Control+Z");
  await expect.poll(() => readPersistedTexts(page)).toEqual(["Reloaded note"]);
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
  await expect(objectSettingsPanel.locator("[data-fill-color]")).toHaveCount(6);
  await expect(objectSettingsPanel.locator("[data-opacity-control]")).toBeVisible();
  await expect(objectSettingsPanel.locator("[data-text-align-panel]")).toBeVisible();
  await expect(objectSettingsPanel.locator("[data-text-align]")).toHaveCount(3);
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
  await objectSettingsPanel.locator('[data-text-align="center"]').click();
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
  await setOpacity(page, 52);

  await expect
    .poll(async () => {
      const [element] = await readPersistedElements(page);

      return element;
    })
    .toMatchObject({
      textAlign: "center",
      style: {
        stroke: "#61746b",
        fill: "#e8f1ec",
        lineWidth: 4,
        opacity: 0.52,
      },
    });

  await page.keyboard.press("5");
  await expectActiveTool(page, "rectangle");
  await dragCanvas(page, { x: 260, y: 130 }, { x: 360, y: 180 });
  await expectActiveTool(page, "select");

  await expect
    .poll(async () => {
      const elements = await readPersistedElements(page);
      const rectangle = elements.find((element) => element.type === "rectangle");

      return rectangle?.style?.lineWidth;
    })
    .toBe(4);

  await canvas.click({ position: { x: 310, y: 155 } });
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

  await expect(objectSettingsPanel.locator("[data-selection-actions]")).toBeVisible();
  await objectSettingsPanel.locator("[data-copy-selection]").click();
  await page.keyboard.press("Control+V");
  await expect.poll(() => readPersistedElements(page)).toHaveLength(3);

  await objectSettingsPanel.locator("[data-delete-selection]").click();
  await expect.poll(() => readPersistedElements(page)).toHaveLength(2);
});

test("configures a shared border radius for rectangles and diamonds", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Rectangle" })).toBeVisible();

  await page.getByRole("button", { name: "Clear" }).click();
  await expect.poll(() => readPersistedElements(page)).toEqual([]);

  const canvas = page.locator("[data-canvas]");
  const borderRadiusPanel = page.locator("[data-border-radius-panel]");

  await expect(borderRadiusPanel).toBeHidden();
  await page.getByRole("button", { name: "Text" }).click();
  await expect(borderRadiusPanel).toBeHidden();
  await page.getByRole("button", { name: "Ellipse" }).click();
  await expect(borderRadiusPanel).toBeHidden();

  await page.getByRole("button", { name: "Rectangle" }).click();
  await expect(borderRadiusPanel).toBeVisible();

  const presets = [
    { label: "None", radius: 0 },
    { label: "Small", radius: 4 },
    { label: "Medium", radius: 8 },
    { label: "Large", radius: 16 },
  ] as const;

  await expect(borderRadiusPanel.locator("[data-border-radius]")).toHaveCount(presets.length);

  for (const preset of presets) {
    const control = borderRadiusPanel.getByRole("button", {
      name: preset.label,
      exact: true,
    });

    await expect(control).toHaveAttribute("data-radius", String(preset.radius));
    await setBorderRadius(page, preset.radius);
    await expect(control).toHaveAttribute("aria-pressed", "true");
  }

  await setBorderRadius(page, 8);
  await dragCanvas(page, { x: 220, y: 180 }, { x: 340, y: 240 });
  await expectActiveTool(page, "select");
  await expect(borderRadiusPanel).toBeHidden();
  await expect
    .poll(() => countDarkCanvasPixels(page, { x: 220, y: 180, width: 2, height: 2 }))
    .toBeLessThanOrEqual(1);
  await expect
    .poll(() => countDarkCanvasPixels(page, { x: 230, y: 179, width: 8, height: 4 }))
    .toBeGreaterThan(0);

  await page.getByRole("button", { name: "Diamond" }).click();
  await expect(borderRadiusPanel).toBeVisible();
  await expect(
    borderRadiusPanel.getByRole("button", { name: "Medium", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await dragCanvas(page, { x: 400, y: 180 }, { x: 520, y: 260 });
  await expect
    .poll(() => countDarkCanvasPixels(page, { x: 458, y: 179, width: 4, height: 2 }))
    .toBeLessThanOrEqual(1);
  await expect
    .poll(() => countDarkCanvasPixels(page, { x: 456, y: 182, width: 8, height: 5 }))
    .toBeGreaterThan(0);

  await expect
    .poll(async () =>
      (await readPersistedElements(page)).map((element) => ({
        type: element.type,
        borderRadius: element.style?.borderRadius,
      })),
    )
    .toEqual([
      { type: "rectangle", borderRadius: 8 },
      { type: "diamond", borderRadius: 8 },
    ]);

  await expect(page.locator("[data-save-state]")).toHaveAttribute("data-state", "saved");
  await page.reload();

  await expect
    .poll(async () =>
      (await readPersistedElements(page)).map((element) => element.style?.borderRadius),
    )
    .toEqual([8, 8]);
  await expect(borderRadiusPanel).toBeHidden();

  await canvas.click({ position: { x: 220, y: 210 } });
  await expect(borderRadiusPanel).toBeVisible();
});

test("updates border radius only for eligible shapes with undo and redo", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Rectangle" })).toBeVisible();

  await page.getByRole("button", { name: "Clear" }).click();
  await expect.poll(() => readPersistedElements(page)).toEqual([]);

  const canvas = page.locator("[data-canvas]");
  const borderRadiusPanel = page.locator("[data-border-radius-panel]");
  const textEditor = page.locator("[data-text-editor]");

  await page.getByRole("button", { name: "Rectangle" }).click();
  await setBorderRadius(page, 8);
  await dragCanvas(page, { x: 220, y: 180 }, { x: 340, y: 240 });

  await page.getByRole("button", { name: "Diamond" }).click();
  await setBorderRadius(page, 4);
  await dragCanvas(page, { x: 400, y: 180 }, { x: 520, y: 260 });

  await page.getByRole("button", { name: "Text" }).click();
  await canvas.click({ position: { x: 300, y: 340 } });
  await textEditor.fill("Radius invariant");
  await textEditor.press("Control+Enter");
  await expect.poll(() => readPersistedElements(page)).toHaveLength(3);

  const textStyleBefore = (await readPersistedElements(page)).find(
    (element) => element.type === "text",
  )?.style;

  await page.keyboard.press("Control+A");
  await expect(borderRadiusPanel).toBeVisible();
  await expect(borderRadiusPanel.locator('[data-border-radius][aria-pressed="true"]')).toHaveCount(
    0,
  );

  await setBorderRadius(page, 16);
  await expect
    .poll(async () => {
      const elements = await readPersistedElements(page);

      return {
        rectangle: elements.find((element) => element.type === "rectangle")?.style?.borderRadius,
        diamond: elements.find((element) => element.type === "diamond")?.style?.borderRadius,
        textStyle: elements.find((element) => element.type === "text")?.style,
      };
    })
    .toEqual({ rectangle: 16, diamond: 16, textStyle: textStyleBefore });

  await page.keyboard.press("Control+z");
  await expect
    .poll(async () =>
      (await readPersistedElements(page))
        .filter((element) => element.type === "rectangle" || element.type === "diamond")
        .map((element) => element.style?.borderRadius),
    )
    .toEqual([8, 4]);
  await expect(borderRadiusPanel.locator('[data-border-radius][aria-pressed="true"]')).toHaveCount(
    0,
  );

  await page.keyboard.press("Control+Shift+z");
  await expect
    .poll(async () =>
      (await readPersistedElements(page))
        .filter((element) => element.type === "rectangle" || element.type === "diamond")
        .map((element) => element.style?.borderRadius),
    )
    .toEqual([16, 16]);
  await expect(
    borderRadiusPanel.getByRole("button", { name: "Large", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");

  await expect(page.locator("[data-save-state]")).toHaveAttribute("data-state", "saved");
  await page.reload();
  await expect
    .poll(async () =>
      (await readPersistedElements(page))
        .filter((element) => element.type === "rectangle" || element.type === "diamond")
        .map((element) => element.style?.borderRadius),
    )
    .toEqual([16, 16]);
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

test("keeps inline text editor size aligned at minimum zoom", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Text" })).toBeVisible();

  await page.getByRole("button", { name: "Clear" }).click();
  await expect.poll(() => readPersistedElements(page)).toEqual([]);

  const canvas = page.locator("[data-canvas]");
  const textEditor = page.locator("[data-text-editor]");
  const textPoint = { x: 320, y: 260 };

  const minimumZoom = await zoomOutToMinimum(page);

  await page.getByRole("button", { name: "Text" }).click();
  await canvas.click({ position: textPoint });
  await expect(textEditor).toBeVisible();

  const createMetrics = await readTextEditorVisualMetrics(page);

  expect(createMetrics.fontSize).toBeCloseTo(24, 4);
  expect(createMetrics.scale).toBeCloseTo(minimumZoom, 4);
  expect(createMetrics.visualFontSize).toBeCloseTo(24 * minimumZoom, 4);

  await textEditor.fill("Tiny note");
  await textEditor.press("Control+Enter");
  await expect.poll(() => readPersistedTexts(page)).toEqual(["Tiny note"]);

  await canvas.dblclick({ position: { x: textPoint.x + 6, y: textPoint.y + 6 } });
  await expect(textEditor).toBeVisible();
  await expect(textEditor).toHaveValue("Tiny note");

  const editMetrics = await readTextEditorVisualMetrics(page);

  expect(editMetrics.fontSize).toBeCloseTo(24, 4);
  expect(editMetrics.scale).toBeCloseTo(minimumZoom, 4);
  expect(editMetrics.visualFontSize).toBeCloseTo(24 * minimumZoom, 4);
});

test("keeps selected short text bounds tight and vertically centered", async ({ page }) => {
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
  await textEditor.fill("Nikita");
  await textEditor.press("Control+Enter");

  await expect.poll(() => readPersistedTexts(page)).toEqual(["Nikita"]);
  await expectActiveTool(page, "select");

  const [persistedText] = await readPersistedElements(page);
  const renderedTextWidth = await measureCanvasTextWidth(page, "Nikita");
  const darkBounds = await readDarkCanvasPixelBounds(page, {
    x: textPoint.x,
    y: textPoint.y,
    width: 100,
    height: 50,
  });

  expect(persistedText?.type).toBe("text");
  expect(persistedText?.width ?? 0).toBeCloseTo(
    renderedTextWidth + TEXT_RENDERER_HORIZONTAL_INSET,
    4,
  );
  expect(persistedText?.width ?? 0).toBeLessThan(90);
  expect(darkBounds).toBeDefined();

  const visualTextCenterY = ((darkBounds?.minY ?? 0) + (darkBounds?.maxY ?? 0)) / 2;
  const selectedBoundsCenterY = (24 * TEXT_LINE_HEIGHT) / 2;

  expect(Math.abs(visualTextCenterY - selectedBoundsCenterY)).toBeLessThanOrEqual(1.5);
});

test("keeps long uninterrupted text on one visual editor line", async ({ page }) => {
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

  await textEditor.fill(LONG_UNINTERRUPTED_TEXT);
  await expectTextEditorToStayOnOneVisualLine(page);

  await textEditor.press("Control+Enter");
  await expect.poll(() => readPersistedTexts(page)).toEqual([LONG_UNINTERRUPTED_TEXT]);

  const [persistedText] = await readPersistedElements(page);
  const renderedTextWidth = await measureCanvasTextWidth(page, LONG_UNINTERRUPTED_TEXT);

  expect(persistedText?.type).toBe("text");
  expect(persistedText?.width ?? 0).toBeGreaterThanOrEqual(
    renderedTextWidth + TEXT_RENDERER_HORIZONTAL_INSET,
  );

  await canvas.dblclick({ position: { x: textPoint.x + 6, y: textPoint.y + 6 } });
  await expect(textEditor).toBeVisible();
  await expect(textEditor).toHaveValue(LONG_UNINTERRUPTED_TEXT);
  await expectTextEditorToStayOnOneVisualLine(page, true);

  const editorBox = await textEditor.boundingBox();

  expect(editorBox?.x).toBeCloseTo(textPoint.x, 0);
  expect(editorBox?.y).toBeCloseTo(textPoint.y, 0);
  expect(editorBox?.width).toBeCloseTo(persistedText?.width ?? 0, 0);
  expect(editorBox?.height).toBeCloseTo(24 * TEXT_LINE_HEIGHT, 0);
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
  expect(editorBox?.y).toBeCloseTo(textPoint.y, 0);
  expect(editorBox?.height).toBeCloseTo(24 * TEXT_LINE_HEIGHT, 0);
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

  await setFillColor(page, OPAQUE_FILL_COLOR);
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
  const layerPanel = page.locator("[data-object-settings-panel] [data-layer-panel]");

  await page.getByRole("button", { name: "Arrow" }).click();
  await dragCanvas(page, { x: 260, y: 260 }, { x: 580, y: 260 });
  await expect
    .poll(() => readPersistedElements(page))
    .toMatchObject([
      {
        type: "arrow",
        points: [
          { x: 260, y: 260 },
          { x: 420, y: 260 },
          { x: 580, y: 260 },
        ],
      },
    ]);
  await expectActiveTool(page, "select");

  await page.getByRole("button", { name: "Select" }).click();
  await canvas.click({ position: { x: 420, y: 260 } });
  await dragCanvas(page, { x: 420, y: 260 }, { x: 420, y: 100 });

  await expect
    .poll(() => readPersistedElements(page))
    .toMatchObject([
      {
        type: "arrow",
        points: [
          { x: 260, y: 260 },
          { x: 420, y: 100 },
          { x: 580, y: 260 },
        ],
      },
    ]);
  await expect
    .poll(() => countDarkCanvasPixels(page, { x: 408, y: 88, width: 24, height: 24 }))
    .toBeGreaterThan(8);
  await expect
    .poll(() => countDarkCanvasPixels(page, { x: 506, y: 166, width: 8, height: 8 }))
    .toBeGreaterThan(3);
  await expect
    .poll(() => countDarkCanvasPixels(page, { x: 506, y: 186, width: 8, height: 8 }))
    .toBeLessThanOrEqual(1);

  await page.keyboard.press("Control+z");
  await expect
    .poll(() => readPersistedElements(page))
    .toMatchObject([
      {
        type: "arrow",
        points: [
          { x: 260, y: 260 },
          { x: 420, y: 260 },
          { x: 580, y: 260 },
        ],
      },
    ]);
  await expect
    .poll(() => countDarkCanvasPixels(page, { x: 496, y: 256, width: 8, height: 8 }))
    .toBeGreaterThan(3);

  await page.keyboard.press("Control+Shift+z");
  await expect
    .poll(() => readPersistedElements(page))
    .toMatchObject([
      {
        type: "arrow",
        points: [
          { x: 260, y: 260 },
          { x: 420, y: 100 },
          { x: 580, y: 260 },
        ],
      },
    ]);
  await expect
    .poll(() => countDarkCanvasPixels(page, { x: 506, y: 166, width: 8, height: 8 }))
    .toBeGreaterThan(3);

  await canvas.click({ position: { x: 700, y: 400 } });
  await expect(layerPanel).toBeHidden();
  await canvas.click({ position: { x: 510, y: 190 } });
  await expect(layerPanel).toBeHidden();
  await page.keyboard.press("Delete");
  await expect.poll(() => readPersistedElements(page)).toHaveLength(1);

  await canvas.click({ position: { x: 510, y: 170 } });
  await expect(layerPanel).toBeVisible();
  await page.keyboard.press("Delete");
  await expect.poll(() => readPersistedElements(page)).toEqual([]);
  await page.keyboard.press("Control+z");
  await expect.poll(() => readPersistedElements(page)).toHaveLength(1);
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

  await setFillColor(page, OPAQUE_FILL_COLOR);
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
