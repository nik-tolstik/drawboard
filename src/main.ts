import { SceneStore, type SaveState } from "./application/SceneStore";
import type { LayerOrderCommand } from "./application/SceneStore";
import type { Tool } from "./domain/elements";
import { IndexedDbSceneRepository } from "./infrastructure/indexedDbSceneRepository";
import { CanvasRenderer } from "./ui/CanvasRenderer";
import { EditorController } from "./ui/EditorController";
import { getIcon } from "./ui/icons";
import "./styles.css";

const tools: Array<{ id: Tool; label: string; shortcut: string; numericShortcut?: string }> = [
  { id: "select", label: "Select", shortcut: "V", numericShortcut: "1" },
  { id: "brush", label: "Brush", shortcut: "B", numericShortcut: "2" },
  { id: "text", label: "Text", shortcut: "T", numericShortcut: "3" },
  { id: "square", label: "Square", shortcut: "S", numericShortcut: "4" },
  { id: "diamond", label: "Diamond", shortcut: "D", numericShortcut: "5" },
  { id: "circle", label: "Circle", shortcut: "C", numericShortcut: "6" },
  { id: "arrow", label: "Arrow", shortcut: "A" },
];

const layerControls: Array<{
  action: LayerOrderCommand;
  label: string;
  icon: Parameters<typeof getIcon>[0];
}> = [
  { action: "backward", label: "Назад", icon: "layerBackward" },
  { action: "forward", label: "Вперёд", icon: "layerForward" },
  { action: "front", label: "Полностью вперёд", icon: "layerToFront" },
  { action: "back", label: "Полностью назад", icon: "layerToBack" },
];

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App root was not found.");
}

app.innerHTML = `
  <main class="app-shell">
    <header class="top-bar" aria-label="Whiteboard controls">
      <section class="brand" aria-label="Application">
        <img class="brand__mark" src="/logo.svg" alt="" aria-hidden="true" />
        <span class="brand__name">SketchBoard</span>
      </section>

      <nav class="toolbar" aria-label="Drawing tools">
        ${tools
          .map(
            (tool) => `
              <button class="icon-button" type="button" data-tool="${tool.id}" aria-label="${tool.label}" title="${tool.label} (${[tool.numericShortcut, tool.shortcut].filter(Boolean).join(", ")})">
                ${getIcon(tool.id)}
              </button>
            `,
          )
          .join("")}
      </nav>

      <section class="actions" aria-label="Scene actions">
        <span class="save-state" data-save-state>Ready</span>
        <label class="color-control" title="Stroke color">
          <span>Stroke</span>
          <input type="color" value="#171717" data-stroke-color />
        </label>
        <label class="color-control" title="Fill color">
          <span>Fill</span>
          <input type="color" value="#ffffff" data-fill-color />
        </label>
        <button class="text-button" type="button" data-clear>
          ${getIcon("clear")}
          <span>Clear</span>
        </button>
        <button class="text-button text-button--primary" type="button" data-export>
          ${getIcon("export")}
          <span>PNG</span>
        </button>
      </section>
    </header>

    <div class="canvas-frame">
      <canvas class="drawing-canvas" data-canvas aria-label="Drawing canvas"></canvas>
      <textarea class="inline-text-editor" data-text-editor rows="1" spellcheck="false" hidden></textarea>
      <aside class="help-panel" aria-label="Canvas tips">
        <span>Middle mouse drag pans the canvas</span>
      </aside>
      <section class="layer-panel" data-layer-panel aria-label="Layer controls" hidden>
        ${layerControls
          .map(
            (control) => `
              <button class="icon-button" type="button" data-layer-action="${control.action}" aria-label="${control.label}" title="${control.label}">
                ${getIcon(control.icon)}
              </button>
            `,
          )
          .join("")}
      </section>
    </div>
  </main>
`;

const canvas = app.querySelector<HTMLCanvasElement>("[data-canvas]");
const saveState = app.querySelector<HTMLElement>("[data-save-state]");
const textEditor = app.querySelector<HTMLTextAreaElement>("[data-text-editor]");
const strokeColor = app.querySelector<HTMLInputElement>("[data-stroke-color]");
const fillColor = app.querySelector<HTMLInputElement>("[data-fill-color]");
const layerPanel = app.querySelector<HTMLElement>("[data-layer-panel]");

if (!canvas || !saveState || !textEditor || !strokeColor || !fillColor || !layerPanel) {
  throw new Error("Application controls were not initialized.");
}

const repository = new IndexedDbSceneRepository();
const store = new SceneStore(repository);
const renderer = new CanvasRenderer(canvas);
let latestScene = store.getSnapshot();
let latestRenderOptions: Parameters<CanvasRenderer["render"]>[1] = {};
let closeOpenTextEditor: (() => void) | undefined;

const TEXT_EDITOR_VERTICAL_OFFSET = 2;

type TextEditorOptions = {
  initialText?: string;
  fontSize?: number;
  textColor?: string;
  onCommit: (text: string) => void;
  onCancel?: () => void;
};

const resizeObserver = new ResizeObserver(() => {
  renderer.resize();
  renderer.render(latestScene, latestRenderOptions);
});

const renderWithPreview = (options: Parameters<CanvasRenderer["render"]>[1] = {}): void => {
  latestRenderOptions = options;
  renderer.render(latestScene, options);
};

const setActiveToolButton = (tool: Tool): void => {
  app.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((button) => {
    button.dataset.active = button.dataset.tool === tool ? "true" : "false";
  });
};

const setSaveState = (state: SaveState): void => {
  const labels: Record<SaveState, string> = {
    idle: "Ready",
    loading: "Loading",
    saving: "Saving",
    saved: "Saved",
    error: "Storage error",
  };

  saveState.textContent = labels[state];
  saveState.dataset.state = state;
};

const updateLayerPanel = (): void => {
  const hasSelection = controller.getSelectedElementIds().size > 0;

  layerPanel.hidden = !hasSelection;
  app.querySelectorAll<HTMLButtonElement>("[data-layer-action]").forEach((button) => {
    button.disabled = !hasSelection;
  });
};

const openTextEditor = (
  screenPoint: { x: number; y: number },
  options: TextEditorOptions,
): void => {
  closeOpenTextEditor?.();

  const viewportZoom = latestScene.viewport.zoom;
  const baseFontSize = options.fontSize ?? 24;
  const editorFontSize = Math.max(14, baseFontSize * viewportZoom);
  let isOpen = true;
  let shouldCommit = true;

  const resizeEditor = (): void => {
    const lines = textEditor.value.split("\n");
    const longestLineLength = Math.max(1, ...lines.map((line) => line.length));
    const width = Math.min(
      Math.max(longestLineLength * editorFontSize * 0.62 + 14, 120 * viewportZoom),
      460,
    );
    const height = Math.max(lines.length * editorFontSize * 1.3 + 6, 32 * viewportZoom);

    textEditor.style.width = `${width}px`;
    textEditor.style.height = `${height}px`;
  };

  const close = (): void => {
    if (!isOpen) {
      return;
    }

    isOpen = false;
    textEditor.hidden = true;
    textEditor.removeEventListener("input", resizeEditor);
    textEditor.onblur = null;
    textEditor.onkeydown = null;
    closeOpenTextEditor = undefined;

    if (shouldCommit) {
      options.onCommit(textEditor.value);
    } else {
      options.onCancel?.();
    }
  };

  const cancel = (): void => {
    shouldCommit = false;
    close();
  };
  closeOpenTextEditor = close;

  textEditor.value = options.initialText ?? "";
  textEditor.hidden = false;
  textEditor.style.left = `${screenPoint.x}px`;
  textEditor.style.top = `${screenPoint.y - TEXT_EDITOR_VERTICAL_OFFSET}px`;
  textEditor.style.color = options.textColor ?? "var(--text)";
  textEditor.style.fontSize = `${editorFontSize}px`;
  textEditor.addEventListener("input", resizeEditor);
  textEditor.onblur = close;
  textEditor.onkeydown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
      return;
    }

    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      close();
    }
  };
  resizeEditor();
  window.setTimeout(() => {
    if (isOpen) {
      textEditor.focus();
      textEditor.setSelectionRange(textEditor.value.length, textEditor.value.length);
    }
  }, 0);
};

const controller = new EditorController(
  canvas,
  store,
  renderWithPreview,
  (isPanning) => {
    canvas.dataset.panning = String(isPanning);
  },
  openTextEditor,
  updateLayerPanel,
);

resizeObserver.observe(canvas);
renderer.resize();

store.subscribe((scene) => {
  latestScene = scene;
  renderer.render(scene, latestRenderOptions);
  controller.refreshSelection();
});

store.subscribeSaveState(setSaveState);

app.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((button) => {
  button.addEventListener("click", () => {
    const tool = button.dataset.tool as Tool | undefined;

    if (!tool) {
      return;
    }

    controller.setTool(tool);
    setActiveToolButton(tool);
  });
});

strokeColor.addEventListener("change", () => {
  controller.setStyle({
    stroke: strokeColor.value,
  });
});

fillColor.addEventListener("change", () => {
  controller.setStyle({
    fill: fillColor.value,
  });
});

app.querySelector<HTMLButtonElement>("[data-clear]")?.addEventListener("click", () => {
  store.clear();
});

app.querySelector<HTMLButtonElement>("[data-export]")?.addEventListener("click", () => {
  controller.exportPng();
});

app.querySelectorAll<HTMLButtonElement>("[data-layer-action]").forEach((button) => {
  button.addEventListener("click", () => {
    const action = button.dataset.layerAction as LayerOrderCommand | undefined;

    if (!action) {
      return;
    }

    controller.updateSelectionLayer(action);
    updateLayerPanel();
  });
});

window.addEventListener("keydown", (event) => {
  const target = event.target as HTMLElement | null;

  if (target?.tagName === "TEXTAREA" || target?.tagName === "INPUT") {
    return;
  }

  const isModifierShortcut = event.ctrlKey || event.metaKey;
  const isZKey = event.key.toLowerCase() === "z" || event.code === "KeyZ";
  const isCKey = event.key.toLowerCase() === "c" || event.code === "KeyC";
  const isVKey = event.key.toLowerCase() === "v" || event.code === "KeyV";

  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    controller.deleteSelection();
    return;
  }

  if (isModifierShortcut && isZKey) {
    event.preventDefault();

    if (event.shiftKey) {
      store.redo();
    } else {
      store.undo();
    }

    controller.refreshSelection();
    return;
  }

  if (isModifierShortcut && isCKey) {
    event.preventDefault();
    controller.copySelection();
    return;
  }

  if (isModifierShortcut && isVKey) {
    event.preventDefault();
    controller.pasteSelection();
    return;
  }

  if (isModifierShortcut) {
    return;
  }

  const tool = tools.find(
    (candidate) =>
      candidate.shortcut.toLowerCase() === event.key.toLowerCase() ||
      candidate.numericShortcut === event.key,
  );

  if (!tool) {
    return;
  }

  controller.setTool(tool.id);
  setActiveToolButton(tool.id);
});

setActiveToolButton(controller.getTool());
updateLayerPanel();
void store.hydrate();
