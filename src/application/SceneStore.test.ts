import { describe, expect, it } from "vitest";
import { createTextElement, type SceneSnapshot } from "../domain/elements";
import { createEmptyScene } from "../domain/scene";
import { SceneStore } from "./SceneStore";

const createRepository = (initialScene: SceneSnapshot = createEmptyScene()) => {
  const saved: SceneSnapshot[] = [];

  return {
    saved,
    async load() {
      return initialScene;
    },
    async save(scene: SceneSnapshot) {
      saved.push(scene);
    },
    async clear() {
      saved.length = 0;
    },
  };
};

describe("SceneStore", () => {
  it("undoes and redoes element changes", async () => {
    const repository = createRepository();
    const store = new SceneStore(repository);
    await store.hydrate();

    store.addElement(createTextElement({ x: 10, y: 10 }, "first"));
    store.addElement(createTextElement({ x: 20, y: 20 }, "second"));

    expect(store.getSnapshot().elements).toHaveLength(2);
    expect(store.undo()).toBe(true);
    expect(store.getSnapshot().elements.map((element) => element.type)).toEqual(["text"]);
    expect(store.redo()).toBe(true);
    expect(store.getSnapshot().elements).toHaveLength(2);
  });

  it("does not add viewport updates to the undo history", async () => {
    const repository = createRepository();
    const store = new SceneStore(repository);
    await store.hydrate();

    store.addElement(createTextElement({ x: 10, y: 10 }, "first"));
    store.updateViewport({ x: 100, y: 50, zoom: 1 });

    expect(store.undo()).toBe(true);
    expect(store.getSnapshot().elements).toHaveLength(0);
    expect(store.getSnapshot().viewport).toEqual({ x: 100, y: 50, zoom: 1 });
  });

  it("removes elements as one undoable change", async () => {
    const repository = createRepository();
    const store = new SceneStore(repository);
    await store.hydrate();
    const first = createTextElement({ x: 10, y: 10 }, "first");
    const second = createTextElement({ x: 20, y: 20 }, "second");

    store.addElement(first);
    store.addElement(second);
    store.removeElements(new Set([first.id, second.id]));

    expect(store.getSnapshot().elements).toHaveLength(0);
    expect(store.undo()).toBe(true);
    expect(store.getSnapshot().elements).toHaveLength(2);
  });

  it("adds pasted elements and applies selected styles as undoable changes", async () => {
    const repository = createRepository();
    const store = new SceneStore(repository);
    await store.hydrate();
    const first = createTextElement({ x: 10, y: 10 }, "first");
    const second = createTextElement({ x: 20, y: 20 }, "second");

    store.addElements([first, second]);
    store.updateElementsStyle(new Set([first.id]), { stroke: "#ff0000", fill: "#00ff00" });

    expect(store.getSnapshot().elements[0]?.style.stroke).toBe("#ff0000");
    expect(store.undo()).toBe(true);
    expect(store.getSnapshot().elements[0]?.style.stroke).not.toBe("#ff0000");
    expect(store.undo()).toBe(true);
    expect(store.getSnapshot().elements).toHaveLength(0);
  });

  it("assigns new elements to increasing top layers", async () => {
    const repository = createRepository();
    const store = new SceneStore(repository);
    await store.hydrate();
    const first = createTextElement({ x: 10, y: 10 }, "first");
    const second = createTextElement({ x: 20, y: 20 }, "second");

    store.addElement(first);
    store.addElement(second);

    expect(store.getSnapshot().elements.map((element) => element.layer)).toEqual([0, 1]);
  });

  it("moves selected elements through layer order", async () => {
    const repository = createRepository();
    const store = new SceneStore(repository);
    await store.hydrate();
    const first = createTextElement({ x: 10, y: 10 }, "first");
    const second = createTextElement({ x: 20, y: 20 }, "second");
    const third = createTextElement({ x: 30, y: 30 }, "third");

    store.addElements([first, second, third]);

    expect(store.updateElementsLayer(new Set([second.id]), "backward")).toBe(true);
    expect(store.getSnapshot().elements.map((element) => element.layer)).toEqual([1, 0, 2]);

    expect(store.updateElementsLayer(new Set([second.id]), "forward")).toBe(true);
    expect(store.getSnapshot().elements.map((element) => element.layer)).toEqual([0, 1, 2]);

    expect(store.updateElementsLayer(new Set([first.id]), "front")).toBe(true);
    expect(store.getSnapshot().elements.map((element) => element.layer)).toEqual([2, 0, 1]);

    expect(store.updateElementsLayer(new Set([first.id]), "back")).toBe(true);
    expect(store.getSnapshot().elements.map((element) => element.layer)).toEqual([0, 1, 2]);
  });

  it("keeps layer changes undoable", async () => {
    const repository = createRepository();
    const store = new SceneStore(repository);
    await store.hydrate();
    const first = createTextElement({ x: 10, y: 10 }, "first");
    const second = createTextElement({ x: 20, y: 20 }, "second");

    store.addElements([first, second]);
    store.updateElementsLayer(new Set([first.id]), "front");

    expect(store.getSnapshot().elements.map((element) => element.layer)).toEqual([1, 0]);
    expect(store.undo()).toBe(true);
    expect(store.getSnapshot().elements.map((element) => element.layer)).toEqual([0, 1]);
  });

  it("replaces moved elements as one undoable change", async () => {
    const repository = createRepository();
    const store = new SceneStore(repository);
    await store.hydrate();
    const element = createTextElement({ x: 10, y: 10 }, "first");

    store.addElement(element);
    store.replaceElements([{ ...element, x: 80, y: 90 }]);

    expect(store.getSnapshot().elements[0]).toMatchObject({ x: 80, y: 90 });
    expect(store.undo()).toBe(true);
    expect(store.getSnapshot().elements[0]).toMatchObject({ x: 10, y: 10 });
  });
});
