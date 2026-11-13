import React from 'react';
import { Flame, RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import {
  HEATMAP_GRADIENT_PRESETS,
  HeatmapConfig,
  HeatmapGradientPresetId,
} from '../utils/heatmapUtils';

interface HeatmapSettingsPanelProps {
  config: HeatmapConfig;
  onChange: (updater: HeatmapConfig | ((prev: HeatmapConfig) => HeatmapConfig)) => void;
  onReset: () => void;
  onClose: () => void;
  matchingSegmentsCount: number;
  totalSegmentsCount: number;
  heatmapEnabled: boolean;
  onEnableHeatmap: () => void;
}

const DENSITY_QUICK_THRESHOLDS = [
  { label: 'All (0%)', value: 0 },
  { label: 'Mod+ (35%)', value: 35 },
  { label: 'Heavy+ (58%)', value: 58 },
  { label: 'Severe (78%)', value: 78 },
];

const DELAY_QUICK_THRESHOLDS = [
  { label: 'All (0m)', value: 0 },
  { label: '0.3m+', value: 0.3 },
  { label: '0.6m+', value: 0.6 },
  { label: '1.2m+', value: 1.2 },
];

export const HeatmapSettingsPanel: React.FC<HeatmapSettingsPanelProps> = ({
  config,
  onChange,
  onReset,
  onClose,
  matchingSegmentsCount,
  totalSegmentsCount,
  heatmapEnabled,
  onEnableHeatmap,
}) => {
  const update = (patch: Partial<HeatmapConfig>) => {
    onChange((prev) => ({ ...prev, ...patch }));
  };

  const handleCustomColorChange = (index: 0 | 1 | 2, hex: string) => {
    onChange((prev) => {
      const nextColors: [string, string, string] = [...prev.customColors] as [
        string,
        string,
        string,
      ];
      nextColors[index] = hex.toUpperCase();
      return {
        ...prev,
        gradientPreset: 'CUSTOM',
        customColors: nextColors,
      };
    });
  };

  return (
    <div
      role="dialog"
      aria-label="Heatmap Overlay Settings"
      className="absolute top-12 right-3 z-[520] w-80 max-w-[calc(100%-1.5rem)] max-h-[calc(100%-3.75rem)] overflow-y-auto rounded-xl border border-slate-700/90 bg-[#090E1A]/95 p-4 text-xs text-slate-200 shadow-2xl backdrop-blur-md space-y-4"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="w-3.5 h-3.5 text-orange-400" />
          <h3 className="text-xs font-semibold text-white">Heatmap Overlay Settings</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close heatmap settings"
          className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {!heatmapEnabled && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-950/30 px-2.5 py-2 text-[11px] text-amber-200">
          <span>Heatmap is currently OFF.</span>
          <button
            type="button"
            onClick={onEnableHeatmap}
            className="inline-flex items-center gap-1 rounded bg-orange-500/20 border border-orange-400/50 px-2 py-0.5 font-medium text-orange-200 hover:bg-orange-500/35"
          >
            <Flame className="w-3 h-3" />
            <span>Turn ON</span>
          </button>
        </div>
      )}

      {/* Metric Mode: Density vs Travel-Time Delay */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-slate-300">Congestion Metric</span>
          <span className="font-mono text-[10px] text-cyan-300">
            {matchingSegmentsCount}/{totalSegmentsCount} corridors active
          </span>
        </div>
        <div className="grid grid-cols-2 gap-1 rounded-lg border border-slate-800 bg-[#0D1424] p-1">
          <button
            type="button"
            onClick={() => update({ metricMode: 'DENSITY' })}
            className={`rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
              config.metricMode === 'DENSITY'
                ? 'bg-orange-600 text-white shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Density (%)
          </button>
          <button
            type="button"
            onClick={() => update({ metricMode: 'DELAY' })}
            className={`rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
              config.metricMode === 'DELAY'
                ? 'bg-orange-600 text-white shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Travel-Time Delay
          </button>
        </div>
      </div>

      {/* Congestion Threshold Controls */}
      {config.metricMode === 'DENSITY' ? (
        <div className="space-y-2 rounded-lg border border-slate-800/80 bg-[#0D1424]/70 p-2.5">
          <div className="flex items-center justify-between">
            <label htmlFor="heatmap-density-threshold" className="text-[11px] text-slate-300">
              Min Congestion Threshold
            </label>
            <span className="font-mono font-semibold text-orange-300 tabular-nums">
              ≥ {config.densityThresholdPct}%
            </span>
          </div>
          <input
            id="heatmap-density-threshold"
            type="range"
            min="0"
            max="85"
            step="5"
            value={config.densityThresholdPct}
            onChange={(e) => update({ densityThresholdPct: Number(e.target.value) })}
            className="w-full accent-orange-500"
          />
          <div className="grid grid-cols-4 gap-1">
            {DENSITY_QUICK_THRESHOLDS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                onClick={() => update({ densityThresholdPct: preset.value })}
                className={`rounded border px-1 py-1 text-[10px] font-mono transition-colors ${
                  config.densityThresholdPct === preset.value
                    ? 'border-orange-400/70 bg-orange-500/20 text-orange-200'
                    : 'border-slate-700/80 bg-[#090E1A] text-slate-400 hover:text-white'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-2.5 rounded-lg border border-slate-800/80 bg-[#0D1424]/70 p-2.5">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="heatmap-delay-threshold" className="text-[11px] text-slate-300">
                Min Delay Threshold
              </label>
              <span className="font-mono font-semibold text-orange-300 tabular-nums">
                ≥ {config.delayThresholdMin.toFixed(1)} min
              </span>
            </div>
            <input
              id="heatmap-delay-threshold"
              type="range"
              min="0"
              max="3.0"
              step="0.1"
              value={config.delayThresholdMin}
              onChange={(e) => update({ delayThresholdMin: Number(e.target.value) })}
              className="w-full accent-orange-500"
            />
            <div className="grid grid-cols-4 gap-1">
              {DELAY_QUICK_THRESHOLDS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => update({ delayThresholdMin: preset.value })}
                  className={`rounded border px-1 py-1 text-[10px] font-mono transition-colors ${
                    Math.abs(config.delayThresholdMin - preset.value) < 0.05
                      ? 'border-orange-400/70 bg-orange-500/20 text-orange-200'
                      : 'border-slate-700/80 bg-[#090E1A] text-slate-400 hover:text-white'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1 pt-1 border-t border-slate-800/70">
            <div className="flex items-center justify-between">
              <label htmlFor="heatmap-delay-cap" className="text-[11px] text-slate-300">
                Peak Delay Saturation Cap
              </label>
              <span className="font-mono text-cyan-300 tabular-nums">
                {config.delayScaleMaxMin.toFixed(1)} min
              </span>
            </div>
            <input
              id="heatmap-delay-cap"
              type="range"
              min="1.0"
              max="6.0"
              step="0.5"
              value={config.delayScaleMaxMin}
              onChange={(e) => update({ delayScaleMaxMin: Number(e.target.value) })}
              className="w-full accent-cyan-400"
            />
          </div>
        </div>
      )}

      {/* Color Intensity Gradient Selector */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-slate-300">Color Intensity Gradient</span>
          <span className="font-mono text-[10px] text-slate-400">{config.gradientPreset}</span>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          {HEATMAP_GRADIENT_PRESETS.map((preset) => {
            const active = config.gradientPreset === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() =>
                  update({ gradientPreset: preset.id as HeatmapGradientPresetId })
                }
                className={`rounded-lg border p-2 text-left transition-colors space-y-1.5 ${
                  active
                    ? 'border-orange-400/70 bg-orange-950/25 text-white'
                    : 'border-slate-800 bg-[#0D1424] text-slate-300 hover:border-slate-700'
                }`}
              >
                <div className="text-[11px] font-medium truncate">{preset.label}</div>
                <div className={`h-2 w-full rounded-sm ${preset.barClass}`} />
              </button>
            );
          })}
        </div>

        {/* Custom Gradient 3-Stop Picker */}
        <div
          className={`rounded-lg border p-2.5 space-y-2 transition-colors ${
            config.gradientPreset === 'CUSTOM'
              ? 'border-orange-400/70 bg-orange-950/20'
              : 'border-slate-800 bg-[#0D1424]/70'
          }`}
        >
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => update({ gradientPreset: 'CUSTOM' })}
              className="text-[11px] font-medium text-slate-200 hover:text-white"
            >
              Custom 3-Stop Gradient
            </button>
            <span className="font-mono text-[10px] text-slate-400">
              {config.gradientPreset === 'CUSTOM' ? 'ACTIVE' : 'Click color to customize'}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { idx: 0, label: 'Low' },
                { idx: 1, label: 'Mid' },
                { idx: 2, label: 'Peak' },
              ] as const
            ).map((stop) => (
              <label
                key={stop.label}
                className="flex items-center justify-between gap-1 rounded border border-slate-700 bg-[#090E1A] px-2 py-1 cursor-pointer"
              >
                <span className="text-[10px] text-slate-300">{stop.label}</span>
                <input
                  type="color"
                  aria-label={`Custom ${stop.label} gradient color`}
                  value={config.customColors[stop.idx]}
                  onChange={(e) => handleCustomColorChange(stop.idx, e.target.value)}
                  className="h-4 w-5 cursor-pointer rounded border-0 bg-transparent p-0"
                />
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Rendering Intensity, Radius, Opacity & Aggregation */}
      <div className="space-y-2.5 rounded-lg border border-slate-800/80 bg-[#0D1424]/70 p-2.5">
        <div className="space-y-1">
          <div className="flex justify-between text-[11px]">
            <label htmlFor="heatmap-intensity" className="text-slate-300">
              Color Intensity
            </label>
            <span className="font-mono text-slate-200 tabular-nums">
              {config.intensity.toFixed(2)}x
            </span>
          </div>
          <input
            id="heatmap-intensity"
            type="range"
            min="0.5"
            max="2.5"
            step="0.05"
            value={config.intensity}
            onChange={(e) => update({ intensity: Number(e.target.value) })}
            className="w-full accent-orange-500"
          />
        </div>

        <div className="space-y-1">
          <div className="flex justify-between text-[11px]">
            <label htmlFor="heatmap-radius" className="text-slate-300">
              Spread Radius
            </label>
            <span className="font-mono text-slate-200 tabular-nums">{config.radiusPixels} px</span>
          </div>
          <input
            id="heatmap-radius"
            type="range"
            min="16"
            max="64"
            step="2"
            value={config.radiusPixels}
            onChange={(e) => update({ radiusPixels: Number(e.target.value) })}
            className="w-full accent-orange-500"
          />
        </div>

        <div className="space-y-1">
          <div className="flex justify-between text-[11px]">
            <label htmlFor="heatmap-opacity" className="text-slate-300">
              Layer Opacity
            </label>
            <span className="font-mono text-slate-200 tabular-nums">
              {Math.round(config.opacity * 100)}%
            </span>
          </div>
          <input
            id="heatmap-opacity"
            type="range"
            min="0.3"
            max="1.0"
            step="0.05"
            value={config.opacity}
            onChange={(e) => update({ opacity: Number(e.target.value) })}
            className="w-full accent-orange-500"
          />
        </div>

        <div className="flex items-center justify-between pt-1 border-t border-slate-800/70">
          <span className="text-[11px] text-slate-300">Aggregation</span>
          <div className="flex items-center gap-1 rounded border border-slate-800 bg-[#090E1A] p-0.5">
            <button
              type="button"
              onClick={() => update({ aggregation: 'MEAN' })}
              className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
                config.aggregation === 'MEAN'
                  ? 'bg-cyan-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Corridor Mean
            </button>
            <button
              type="button"
              onClick={() => update({ aggregation: 'SUM' })}
              className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
                config.aggregation === 'SUM'
                  ? 'bg-cyan-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Hotspot Sum
            </button>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-slate-800 pt-2.5">
        <span className="font-mono text-[10px] text-cyan-400">SIMULATED TRAFFIC METRICS</span>
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center gap-1 rounded border border-slate-700 bg-[#0D1424] px-2.5 py-1 text-[11px] text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
        >
          <RotateCcw className="w-3 h-3" />
          <span>Reset</span>
        </button>
      </div>
    </div>
  );
};
