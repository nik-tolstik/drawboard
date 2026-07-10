import { expect, test, type Page } from "@playwright/test";

type Point = {
  x: number;
  y: number;
};

type PersistedElement = {
  id?: string;
  type?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fontSize?: number;
  text?: string;
  points?: Point[];
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

type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

type ElementRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const readPersistedScene = async (page: Page): Promise<PersistedScene | undefined> =>
  page.evaluate(
    () =>
      new Promise<PersistedScene | undefined>((resolve, reject) => {
        const request = indexedDB.open("sketchboard-db");

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

const readPersistedElements = async (page: Page): Promise<PersistedElement[]> =>
  (await readPersistedScene(page))?.elements ?? [];

const readElement = async (page: Page, type: string): Promise<PersistedElement> => {
  const element = (await readPersistedElements(page)).find((candidate) => candidate.type === type);

  expect(element, `Expected a persisted ${type} element`).toBeDefined();
  return element!;
};

const elementRect = (element: PersistedElement): ElementRect => ({
  x: element.x ?? 0,
  y: element.y ?? 0,
  width: element.width ?? 0,
  height: element.height ?? 0,
});

const resizeHandlePoint = (rect: ElementRect, handle: ResizeHandle): Point => {
  const left = rect.x;
  const centerX = rect.x + rect.width / 2;
  const right = rect.x + rect.width;
  const top = rect.y;
  const centerY = rect.y + rect.height / 2;
  const bottom = rect.y + rect.height;

  const points: Record<ResizeHandle, Point> = {
    nw: { x: left, y: top },
    n: { x: centerX, y: top },
    ne: { x: right, y: top },
    e: { x: right, y: centerY },
    se: { x: right, y: bottom },
    s: { x: centerX, y: bottom },
    sw: { x: left, y: bottom },
    w: { x: left, y: centerY },
  };

  return points[handle];
};

const worldToCanvas = (point: Point, viewport: PersistedViewport | undefined): Point => {
  const zoom = viewport?.zoom ?? 1;

  return {
    x: point.x * zoom + (viewport?.x ?? 0),
    y: point.y * zoom + (viewport?.y ?? 0),
  };
};

const canvasPointToPage = async (page: Page, point: Point): Promise<Point> => {
  const canvasBox = await page.locator("[data-canvas]").boundingBox();

  expect(canvasBox).not.toBeNull();
  return { x: canvasBox!.x + point.x, y: canvasBox!.y + point.y };
};

const moveToWorldPoint = async (page: Page, point: Point): Promise<void> => {
  const scene = await readPersistedScene(page);
  const screenPoint = worldToCanvas(point, scene?.viewport);
  const pagePoint = await canvasPointToPage(page, screenPoint);

  await page.mouse.move(pagePoint.x, pagePoint.y);
};

const clickWorldPoint = async (page: Page, point: Point): Promise<void> => {
  const scene = await readPersistedScene(page);
  const pagePoint = await canvasPointToPage(page, worldToCanvas(point, scene?.viewport));

  await page.mouse.click(pagePoint.x, pagePoint.y);
};

const dragWorld = async (
  page: Page,
  start: Point,
  end: Point,
  options: { shift?: boolean } = {},
): Promise<void> => {
  const scene = await readPersistedScene(page);
  const startPagePoint = await canvasPointToPage(page, worldToCanvas(start, scene?.viewport));
  const endPagePoint = await canvasPointToPage(page, worldToCanvas(end, scene?.viewport));

  await page.mouse.move(startPagePoint.x, startPagePoint.y);

  if (options.shift) {
    await page.keyboard.down("Shift");
  }

  await page.mouse.down();
  await page.mouse.move(endPagePoint.x, endPagePoint.y, { steps: 8 });
  await page.mouse.up();

  if (options.shift) {
    await page.keyboard.up("Shift");
  }
};

const dragCanvas = async (page: Page, start: Point, end: Point): Promise<void> => {
  const startPagePoint = await canvasPointToPage(page, start);
  const endPagePoint = await canvasPointToPage(page, end);

  await page.mouse.move(startPagePoint.x, startPagePoint.y);
  await page.mouse.down();
  await page.mouse.move(endPagePoint.x, endPagePoint.y, { steps: 8 });
  await page.mouse.up();
};

const expectElementRect = async (
  page: Page,
  type: string,
  expected: ElementRect,
): Promise<void> => {
  await expect.poll(async () => elementRect(await readElement(page, type))).toEqual(expected);
};

const expectCursor = async (page: Page, cursor: string): Promise<void> => {
  await expect
    .poll(() =>
      page.locator("[data-canvas]").evaluate((canvas) => window.getComputedStyle(canvas).cursor),
    )
    .toBe(cursor);
};

const expectNoResizeCursor = async (page: Page): Promise<void> => {
  await expect
    .poll(() =>
      page.locator("[data-canvas]").evaluate((canvas) => window.getComputedStyle(canvas).cursor),
    )
    .not.toMatch(/resize/);
};

const prepareEmptyBoard = async (page: Page): Promise<void> => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Text" })).toBeVisible();
  await page.getByRole("button", { name: "Clear" }).click();
  await page.locator("[data-zoom-reset]").click();
  await expect.poll(() => readPersistedElements(page)).toEqual([]);
};

const createShape = async (
  page: Page,
  type: "rectangle" | "diamond" | "ellipse",
  start: Point,
  end: Point,
): Promise<PersistedElement> => {
  const accessibleNames = {
    rectangle: "Rectangle",
    diamond: "Diamond",
    ellipse: "Ellipse",
  } as const;

  await page.getByRole("button", { name: accessibleNames[type] }).click();
  await dragCanvas(page, start, end);
  await expect.poll(() => readPersistedElements(page)).toHaveLength(1);
  await expect(page.locator('.editor-tool-button[data-tool="select"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  const shape = await readElement(page, type);
  const rect = elementRect(shape);

  // Shapes are not auto-selected after creation. The top-center point lies on the
  // contour of rectangles, diamonds, and ellipses, including transparent shapes.
  await clickWorldPoint(page, { x: rect.x + rect.width / 2, y: rect.y });

  return shape;
};

const createText = async (page: Page, point: Point, text: string): Promise<PersistedElement> => {
  const canvas = page.locator("[data-canvas]");
  const editor = page.locator("[data-text-editor]");

  await page.getByRole("button", { name: "Text" }).click();
  await canvas.click({ position: point });
  await expect(editor).toBeVisible();
  await editor.fill(text);
  await editor.press("Control+Enter");
  await expect.poll(() => readPersistedElements(page)).toHaveLength(1);

  return readElement(page, "text");
};

test("resizes one shape from all eight handles with one-step undo, redo, and reload", async ({
  page,
}) => {
  await prepareEmptyBoard(page);
  const original = elementRect(
    await createShape(page, "rectangle", { x: 240, y: 190 }, { x: 360, y: 250 }),
  );
  const cases: Array<{
    handle: ResizeHandle;
    cursor: string;
    delta: Point;
    expected: ElementRect;
  }> = [
    {
      handle: "nw",
      cursor: "nwse-resize",
      delta: { x: -16, y: -12 },
      expected: { x: 224, y: 178, width: 136, height: 72 },
    },
    {
      handle: "n",
      cursor: "ns-resize",
      delta: { x: 0, y: -12 },
      expected: { x: 240, y: 178, width: 120, height: 72 },
    },
    {
      handle: "ne",
      cursor: "nesw-resize",
      delta: { x: 16, y: -12 },
      expected: { x: 240, y: 178, width: 136, height: 72 },
    },
    {
      handle: "e",
      cursor: "ew-resize",
      delta: { x: 16, y: 0 },
      expected: { x: 240, y: 190, width: 136, height: 60 },
    },
    {
      handle: "se",
      cursor: "nwse-resize",
      delta: { x: 16, y: 12 },
      expected: { x: 240, y: 190, width: 136, height: 72 },
    },
    {
      handle: "s",
      cursor: "ns-resize",
      delta: { x: 0, y: 12 },
      expected: { x: 240, y: 190, width: 120, height: 72 },
    },
    {
      handle: "sw",
      cursor: "nesw-resize",
      delta: { x: -16, y: 12 },
      expected: { x: 224, y: 190, width: 136, height: 72 },
    },
    {
      handle: "w",
      cursor: "ew-resize",
      delta: { x: -16, y: 0 },
      expected: { x: 224, y: 190, width: 136, height: 60 },
    },
  ];

  for (const [index, currentCase] of cases.entries()) {
    const start = resizeHandlePoint(original, currentCase.handle);

    await moveToWorldPoint(page, start);
    await expectCursor(page, currentCase.cursor);
    await dragWorld(page, start, {
      x: start.x + currentCase.delta.x,
      y: start.y + currentCase.delta.y,
    });
    await expectElementRect(page, "rectangle", currentCase.expected);

    await page.keyboard.press("Control+z");
    await expectElementRect(page, "rectangle", original);

    if (index === cases.length - 1) {
      await page.keyboard.press("Control+Shift+z");
      await expectElementRect(page, "rectangle", currentCase.expected);
      await page.reload();
      await expect(page.getByRole("button", { name: "Text" })).toBeVisible();
      await expectElementRect(page, "rectangle", currentCase.expected);
    }
  }
});

test("keeps a shape ratio with Shift and resizes diamonds and ellipses", async ({ page }) => {
  await prepareEmptyBoard(page);
  const original = elementRect(
    await createShape(page, "rectangle", { x: 240, y: 180 }, { x: 360, y: 240 }),
  );
  const southeast = resizeHandlePoint(original, "se");

  await dragWorld(page, southeast, { x: southeast.x + 30, y: southeast.y + 4 }, { shift: true });

  await expect
    .poll(async () => {
      const resized = elementRect(await readElement(page, "rectangle"));
      return resized.width / resized.height;
    })
    .toBeCloseTo(original.width / original.height, 4);
  await page.keyboard.press("Control+z");
  await expectElementRect(page, "rectangle", original);

  for (const type of ["diamond", "ellipse"] as const) {
    await page.getByRole("button", { name: "Clear" }).click();
    const shape = elementRect(
      await createShape(page, type, { x: 250, y: 190 }, { x: 350, y: 250 }),
    );
    const handle = resizeHandlePoint(shape, "se");

    await dragWorld(page, handle, { x: handle.x + 20, y: handle.y + 15 });
    await expectElementRect(page, type, { ...shape, width: 120, height: 75 });
  }
});

test("reflows text horizontally and scales its font from a vertical handle", async ({ page }) => {
  await prepareEmptyBoard(page);
  const rawText = "Alpha beta gamma delta epsilon";
  const created = await createText(page, { x: 260, y: 190 }, rawText);
  const original = elementRect(created);
  const originalFontSize = created.fontSize ?? 0;
  const east = resizeHandlePoint(original, "e");

  await dragWorld(page, east, { x: original.x + 115, y: east.y });

  await expect
    .poll(async () => {
      const text = await readElement(page, "text");

      return {
        text: text.text,
        x: text.x,
        width: text.width,
        fontSize: text.fontSize,
        isTaller: (text.height ?? 0) > original.height,
      };
    })
    .toEqual({
      text: rawText,
      x: original.x,
      width: 115,
      fontSize: originalFontSize,
      isTaller: true,
    });

  const wrapped = await readElement(page, "text");
  const wrappedRect = elementRect(wrapped);
  const canvas = page.locator("[data-canvas]");
  const editor = page.locator("[data-text-editor]");

  await canvas.dblclick({ position: { x: wrappedRect.x + 5, y: wrappedRect.y + 5 } });
  await expect(editor).toBeVisible();
  await expect(editor).toHaveValue(rawText);
  const editorBox = await editor.boundingBox();
  const editorMetrics = await editor.evaluate((element) => {
    const textarea = element as HTMLTextAreaElement;

    return { clientHeight: textarea.clientHeight, scrollHeight: textarea.scrollHeight };
  });

  expect(editorBox?.width).toBeCloseTo(wrappedRect.width, 0);
  expect(editorMetrics.scrollHeight).toBeLessThanOrEqual(editorMetrics.clientHeight + 2);
  await editor.press("Escape");

  const south = resizeHandlePoint(wrappedRect, "s");

  await dragWorld(page, south, { x: south.x, y: south.y + 40 });
  await expect
    .poll(async () => {
      const text = await readElement(page, "text");
      const rect = elementRect(text);

      return {
        fontGrew: (text.fontSize ?? 0) > originalFontSize,
        widthGrew: rect.width > wrappedRect.width,
        heightGrew: rect.height > wrappedRect.height,
        centerX: rect.x + rect.width / 2,
      };
    })
    .toEqual({
      fontGrew: true,
      widthGrew: true,
      heightGrew: true,
      centerX: wrappedRect.x + wrappedRect.width / 2,
    });
});

test("keeps resize unavailable for multi-selection, brush, and arrow", async ({ page }) => {
  await prepareEmptyBoard(page);
  const rectangle = elementRect(
    await createShape(page, "rectangle", { x: 220, y: 180 }, { x: 340, y: 240 }),
  );

  await page.getByRole("button", { name: "Brush" }).click();
  await dragCanvas(page, { x: 480, y: 190 }, { x: 550, y: 250 });
  await expect.poll(() => readPersistedElements(page)).toHaveLength(2);
  await page.getByRole("button", { name: "Select" }).click();
  await page.keyboard.press("Control+a");

  const northwest = resizeHandlePoint(rectangle, "nw");

  await moveToWorldPoint(page, northwest);
  await expectNoResizeCursor(page);
  await dragWorld(page, northwest, { x: northwest.x - 20, y: northwest.y - 15 });
  await expect
    .poll(async () => {
      const movedRectangle = elementRect(await readElement(page, "rectangle"));

      return { width: movedRectangle.width, height: movedRectangle.height };
    })
    .toEqual({ width: rectangle.width, height: rectangle.height });

  await page.getByRole("button", { name: "Clear" }).click();
  await page.getByRole("button", { name: "Brush" }).click();
  await dragCanvas(page, { x: 300, y: 220 }, { x: 390, y: 270 });
  await page.getByRole("button", { name: "Select" }).click();
  await page.locator("[data-canvas]").click({ position: { x: 345, y: 245 } });
  await moveToWorldPoint(page, { x: 300, y: 220 });
  await expectNoResizeCursor(page);

  await page.getByRole("button", { name: "Clear" }).click();
  await page.getByRole("button", { name: "Arrow" }).click();
  await dragCanvas(page, { x: 300, y: 220 }, { x: 430, y: 280 });
  await page.getByRole("button", { name: "Select" }).click();
  await clickWorldPoint(page, { x: 365, y: 250 });
  await moveToWorldPoint(page, { x: 300, y: 220 });
  await expectNoResizeCursor(page);
});

test("uses constant-screen handles and world-space resizing after zoom", async ({ page }) => {
  await prepareEmptyBoard(page);
  const original = elementRect(
    await createShape(page, "rectangle", { x: 260, y: 200 }, { x: 360, y: 260 }),
  );

  await page.locator("[data-zoom-in]").click();
  await expect(page.locator("[data-zoom-reset]")).toHaveText("120%");
  await expect
    .poll(async () => (await readPersistedScene(page))?.viewport?.zoom)
    .toBeCloseTo(1.2, 4);

  const southeast = resizeHandlePoint(original, "se");

  await moveToWorldPoint(page, southeast);
  await expectCursor(page, "nwse-resize");
  await dragWorld(page, southeast, { x: southeast.x + 20, y: southeast.y + 10 });
  await expectElementRect(page, "rectangle", {
    ...original,
    width: original.width + 20,
    height: original.height + 10,
  });
});
