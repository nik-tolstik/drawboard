import { DEFAULT_STYLE, type LayerOrderCommand } from "@/entities/scene";
import { Button } from "@/shared/ui/button";

import { LAYER_CONTROLS } from "../config/editorConfig";
import { EditorIcon } from "./EditorIcon";

type ObjectSettingsPanelProps = {
  fillColor: string;
  hasSelection: boolean;
  lineWidth: number;
  setFillColor: (color: string) => void;
  setLineWidth: (lineWidth: number) => void;
  setStrokeColor: (color: string) => void;
  strokeColor: string;
  updateSelectionLayer: (command: LayerOrderCommand) => void;
  visible: boolean;
};

type ColorPreset = {
  label: string;
  transparent?: boolean;
  value: string;
};

type StrokeWidthPreset = {
  label: string;
  previewHeight: number;
  value: number;
};

const TRANSPARENT_COLOR = DEFAULT_STYLE.fill;

const STROKE_PRESETS: ColorPreset[] = [
  { label: "Ink", value: "#171717" },
  { label: "Slate", value: "#5f6368" },
  { label: "Moss", value: "#61746b" },
  { label: "Plum", value: "#6f6685" },
  { label: "Clay", value: "#8b6763" },
  { label: "Ochre", value: "#8a735c" },
  { label: "Transparent", transparent: true, value: TRANSPARENT_COLOR },
];

const FILL_PRESETS: ColorPreset[] = [
  { label: "White", value: "#ffffff" },
  { label: "Linen", value: "#f3f0e8" },
  { label: "Mist", value: "#e8eef3" },
  { label: "Sage", value: "#e8f1ec" },
  { label: "Blush", value: "#f1e8e5" },
  { label: "Lavender", value: "#eee9f4" },
  { label: "Transparent", transparent: true, value: TRANSPARENT_COLOR },
];

const STROKE_WIDTH_PRESETS: StrokeWidthPreset[] = [
  { label: "Thin", previewHeight: 1, value: 1 },
  { label: "Medium", previewHeight: 2, value: 2 },
  { label: "Thick", previewHeight: 4, value: 4 },
];

export function ObjectSettingsPanel({
  fillColor,
  hasSelection,
  lineWidth,
  setFillColor,
  setLineWidth,
  setStrokeColor,
  strokeColor,
  updateSelectionLayer,
  visible,
}: ObjectSettingsPanelProps) {
  return (
    <section
      aria-label="Object settings"
      className="object-settings-panel"
      data-object-settings-panel
      hidden={!visible}
    >
      <fieldset className="color-control" title="Stroke color">
        <legend>Stroke</legend>
        <div className="color-control__swatches">
          {STROKE_PRESETS.map((preset) => (
            <button
              key={preset.value}
              aria-label={`Stroke ${preset.label}`}
              aria-pressed={strokeColor === preset.value}
              className={`color-swatch${preset.transparent ? " color-swatch--transparent" : ""}`}
              data-color={preset.value}
              data-stroke-color
              onClick={() => setStrokeColor(preset.value)}
              style={{ backgroundColor: preset.value }}
              type="button"
            />
          ))}
        </div>
      </fieldset>
      <fieldset className="color-control" title="Stroke width">
        <legend>Width</legend>
        <div className="stroke-width-control__options">
          {STROKE_WIDTH_PRESETS.map((preset) => (
            <button
              key={preset.value}
              aria-label={`${preset.label} stroke`}
              aria-pressed={lineWidth === preset.value}
              className="stroke-width-option"
              data-stroke-width
              data-width={preset.value}
              onClick={() => setLineWidth(preset.value)}
              type="button"
            >
              <span
                aria-hidden="true"
                className="stroke-width-option__line"
                style={{ height: `${preset.previewHeight}px` }}
              />
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="color-control" title="Fill color">
        <legend>Fill</legend>
        <div className="color-control__swatches">
          {FILL_PRESETS.map((preset) => (
            <button
              key={preset.value}
              aria-label={`Fill ${preset.label}`}
              aria-pressed={fillColor === preset.value}
              className={`color-swatch${preset.transparent ? " color-swatch--transparent" : ""}`}
              data-color={preset.value}
              data-fill-color
              onClick={() => setFillColor(preset.value)}
              style={{ backgroundColor: preset.value }}
              type="button"
            />
          ))}
        </div>
      </fieldset>
      <fieldset
        className="color-control layer-control"
        data-layer-panel
        hidden={!hasSelection}
        title="Layer controls"
      >
        <legend>Layer</legend>
        <div className="layer-control__buttons">
          {LAYER_CONTROLS.map((control) => (
            <Button
              key={control.action}
              aria-label={control.label}
              className="icon-button layer-control__button"
              data-layer-action={control.action}
              disabled={!hasSelection}
              onClick={() => updateSelectionLayer(control.action)}
              title={control.label}
              type="button"
              variant="ghost"
            >
              <EditorIcon name={control.icon} />
            </Button>
          ))}
        </div>
      </fieldset>
    </section>
  );
}
