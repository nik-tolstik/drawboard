import { expect, test, type Page } from "@playwright/test";

type PersistedElement = {
  type?: string;
  text?: string;
  layer?: number;
};

type PersistedScene = {
  elements?: PersistedElement[];
};

type CanvasRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

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

const readPersistedTexts = async (page: Page): Promise<string[]> => {
  const elements = await readPersistedElements(page);

  return elements.filter((element) => element.type === "text").map((element) => element.text ?? "");
};

const readPersistedLayers = async (page: Page): Promise<number[]> => {
  const elements = await readPersistedElements(page);

  return elements.map((element) => element.layer ?? -1);
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

const setFillColor = async (page: Page, color: string): Promise<void> => {
  await page.locator("[data-fill-color]").evaluate((element, value) => {
    const input = element as HTMLInputElement;

    input.value = value;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, color);
};

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

  await page.getByRole("button", { name: "Square" }).click();
  await dragCanvas(page, { x: 280, y: 220 }, { x: 560, y: 360 });
  await expect.poll(() => readPersistedElements(page)).toHaveLength(2);

  await page.getByRole("button", { name: "Select" }).click();
  await canvas.click({ position: { x: textPoint.x + 8, y: textPoint.y + 8 } });
  await page.keyboard.press("Delete");

  await expect.poll(() => readPersistedElements(page)).toMatchObject([{ type: "square" }]);
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
  await page.getByRole("button", { name: "Square" }).click();
  await dragCanvas(page, { x: 280, y: 220 }, { x: 560, y: 360 });
  await expect.poll(() => readPersistedElements(page)).toHaveLength(2);

  await page.getByRole("button", { name: "Select" }).click();
  await canvas.click({ position: { x: textPoint.x + 8, y: textPoint.y + 8 } });
  await page.keyboard.press("Delete");

  await expect.poll(() => readPersistedTexts(page)).toEqual(["Covered label"]);
  await expect.poll(() => readPersistedElements(page)).toMatchObject([{ type: "text" }]);
});

test("moves selected elements with the bottom layer panel", async ({ page }) => {
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
  await page.getByRole("button", { name: "Square" }).click();
  await dragCanvas(page, { x: 280, y: 220 }, { x: 560, y: 360 });
  await expect.poll(() => readPersistedLayers(page)).toEqual([0, 1]);

  await page.getByRole("button", { name: "Select" }).click();
  await canvas.click({ position: { x: textPoint.x + 8, y: textPoint.y + 8 } });

  await expect(page.getByRole("button", { name: "Назад", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Назад", exact: true }).click();
  await expect.poll(() => readPersistedLayers(page)).toEqual([1, 0]);

  await page.getByRole("button", { name: "Вперёд", exact: true }).click();
  await expect.poll(() => readPersistedLayers(page)).toEqual([0, 1]);

  await page.getByRole("button", { name: "Полностью назад" }).click();
  await expect.poll(() => readPersistedLayers(page)).toEqual([1, 0]);

  await page.getByRole("button", { name: "Полностью вперёд" }).click();
  await expect.poll(() => readPersistedLayers(page)).toEqual([0, 1]);
});
