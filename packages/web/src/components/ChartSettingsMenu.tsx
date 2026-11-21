import type { ReactElement } from "react";
import type { AnnotationLayers } from "../lib/trendAnnotations";
import type { ChartType } from "./TrendChart";

interface Props {
  open: boolean;
  // Today/24h has no annotation data (events/updates/releases/milestones
  // are all computed against the daily series) -- this hides just those
  // sections and the sensitivity slider, not the whole menu. Chart type
  // and export still apply to any series, recent or daily.
  annotationsDisabled?: boolean;
  onToggle: () => void;
  chartType: ChartType;
  onChartTypeChange: (type: ChartType) => void;
  layers: AnnotationLayers;
  onLayersChange: (layers: AnnotationLayers) => void;
  releaseFromLabel: string;
  sens: number;
  onSensChange: (value: number) => void;
  markerCount: number;
  onExport: (kind: "csv" | "json") => void;
}

const LAYERS: { key: keyof AnnotationLayers; label: string; sub: (releaseFromLabel: string) => string; icon: ReactElement }[] = [
  {
    key: "ev",
    label: "Event periods",
    sub: () => "Shading plus start and end markers",
    icon: (
      <svg width={18} height={18} viewBox="0 0 18 18">
        <rect x={1} y={1} width={16} height={16} rx={2} fill="rgba(127,176,214,.16)" />
        <circle cx={9} cy={9} r={4} fill="var(--raise)" stroke="var(--ev)" strokeWidth={1.8} />
      </svg>
    ),
  },
  {
    key: "up",
    label: "Game updates",
    sub: () => "Notable moves within a day of an update",
    icon: (
      <svg width={18} height={18} viewBox="0 0 18 18">
        <circle cx={9} cy={9} r={4.5} fill="var(--up)" />
      </svg>
    ),
  },
  {
    key: "rel",
    label: "Plugin releases",
    sub: (releaseFromLabel) => releaseFromLabel,
    icon: (
      <svg width={18} height={18} viewBox="0 0 18 18">
        <rect x={5} y={5} width={8} height={8} rx={2} fill="var(--rel)" />
      </svg>
    ),
  },
  {
    key: "ms",
    label: "Milestones",
    sub: () => "Total downloads passing round numbers",
    icon: (
      <svg width={18} height={18} viewBox="0 0 18 18">
        <path d="M9 4L14 9L9 14L4 9Z" fill="var(--raise)" stroke="var(--goldHi)" strokeWidth={1.6} />
      </svg>
    ),
  },
];

// Chart type + export + the 5 annotation-layer switches + the sensitivity
// slider, all in one popover anchored off the "Chart settings" trigger
// button -- see design_handoff_trend_chart/README.md's Controls section.
export function ChartSettingsMenu({
  open,
  annotationsDisabled,
  onToggle,
  chartType,
  onChartTypeChange,
  layers,
  onLayersChange,
  releaseFromLabel,
  sens,
  onSensChange,
  markerCount,
  onExport,
}: Props) {
  const offCount = Object.values(layers).filter((v) => !v).length;

  return (
    <>
      <button type="button" className="ppc-btn" aria-haspopup="dialog" aria-expanded={open} onClick={onToggle}>
        <SlidersIcon />
        Chart settings
        {!annotationsDisabled && offCount > 0 && <span className="ppc-badge">{offCount} off</span>}
      </button>

      {open && (
        <div className="ppc-pop ppc-pop--settings" role="dialog" aria-label="Chart settings">
          <div className="ppc-sec">
            <div className="ppc-row">
              <span className="ppc-eyebrow">Chart type</span>
              <div className="ppc-seg" role="radiogroup" aria-label="Chart type">
                <button type="button" role="radio" aria-checked={chartType === "line"} onClick={() => onChartTypeChange("line")}>
                  Line
                </button>
                <button type="button" role="radio" aria-checked={chartType === "bar"} onClick={() => onChartTypeChange("bar")}>
                  Bar
                </button>
              </div>
            </div>
          </div>

          {annotationsDisabled ? (
            <div className="ppc-sec">
              <span className="ppc-note">Annotations and marker sensitivity aren&rsquo;t available for Today/24h -- there&rsquo;s no daily data to annotate.</span>
            </div>
          ) : (
            <>
              <div className="ppc-sec ppc-sec--layers">
                <span className="ppc-eyebrow">Annotations</span>
                {LAYERS.map((l) => (
                  <label className="ppc-layer" key={l.key}>
                    <span className="ppc-layer-ic">{l.icon}</span>
                    <span className="ppc-layer-txt">
                      <span className="ppc-layer-label">{l.label}</span>
                      <span className="ppc-small">{l.sub(releaseFromLabel)}</span>
                    </span>
                    <button
                      type="button"
                      className="ppc-switch"
                      role="switch"
                      aria-checked={layers[l.key]}
                      aria-label={l.label}
                      onClick={() => onLayersChange({ ...layers, [l.key]: !layers[l.key] })}
                    />
                  </label>
                ))}
              </div>

              <div className="ppc-sec">
                <div className="ppc-row ppc-row--base">
                  <span className="ppc-eyebrow">Marker sensitivity</span>
                  <span className="ppc-sens-input">
                    <input
                      type="number"
                      min={0}
                      max={150}
                      step={1}
                      value={sens}
                      aria-label="Marker sensitivity percent"
                      onChange={(e) => onSensChange(clampSens(e.target.value))}
                    />
                    %
                  </span>
                </div>
                <span className="ppc-note">Only mark days that rise or fall at least {sens}% from the days around them.</span>
                <input
                  className="ppc-range"
                  type="range"
                  min={0}
                  max={150}
                  step={1}
                  value={sens}
                  aria-label="Marker sensitivity"
                  onChange={(e) => onSensChange(clampSens(e.target.value))}
                />
                <div className="ppc-scale">
                  <span>More markers</span>
                  <span>{plural(markerCount, "marker")} in view</span>
                  <span>Fewer markers</span>
                </div>
              </div>
            </>
          )}

          <div className="ppc-sec">
            <div className="ppc-row">
              <span className="ppc-eyebrow">Export range</span>
              <div className="ppc-actions">
                <button type="button" className="ppc-ghost" onClick={() => onExport("csv")}>
                  CSV
                </button>
                <button type="button" className="ppc-ghost" onClick={() => onExport("json")}>
                  JSON
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function clampSens(raw: string): number {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(150, n));
}

function SlidersIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden="true">
      <path d="M1.5 3.5H12.5M1.5 7H12.5M1.5 10.5H12.5" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" />
      <circle cx={4.5} cy={3.5} r={1.6} fill="var(--raise)" stroke="currentColor" strokeWidth={1.3} />
      <circle cx={9.5} cy={7} r={1.6} fill="var(--raise)" stroke="currentColor" strokeWidth={1.3} />
      <circle cx={6} cy={10.5} r={1.6} fill="var(--raise)" stroke="currentColor" strokeWidth={1.3} />
    </svg>
  );
}
