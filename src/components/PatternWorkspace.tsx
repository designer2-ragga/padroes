/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import { PatternConfig, Seasoning } from '../types';
import { renderPatternTile, generateSVGPatternString, getCuratedConfigForSeasoning } from '../utils/patternRenderer';
import { PARAMETERS, SpiceId, formatParamValue } from '../engine/parameters';
import { 
  ZoomIn, 
  SlidersHorizontal, 
  RefreshCw, 
  Download,
  Flame
} from 'lucide-react';

interface PatternWorkspaceProps {
  seasoning: Seasoning;
  config: PatternConfig;
  onChangeConfig: (newConfig: PatternConfig) => void;
}

interface FramePreset {
  id: string;
  name: string;
  ratio: number;
  ratioStr: string;
}

const FRAME_PRESETS: FramePreset[] = [
  { id: '1_1', name: 'Quadrado', ratio: 1/1, ratioStr: '1:1' },
  { id: '3_2', name: 'Paisagem', ratio: 3/2, ratioStr: '3:2' },
  { id: '16_9', name: 'Cinema', ratio: 16/9, ratioStr: '16:9' },
  { id: '2_3', name: 'Retrato', ratio: 2/3, ratioStr: '2:3' },
  { id: '9_16', name: 'Story', ratio: 9/16, ratioStr: '9:16' },
];

export default function PatternWorkspace({
  seasoning,
  config,
  onChangeConfig,
}: PatternWorkspaceProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // High-performance continuous seamless design
  const viewMode = 'seamless';
  
  // Active aspect-ratio framing format preset
  const [selectedPreset, setSelectedPreset] = useState<FramePreset>(FRAME_PRESETS[0]);

  // Compute dynamic physical canvas resolution based on the aspect-ratio.
  // This produces extremely crisp downloaded images scaling up to 1200px max bounds,
  // while retaining correct pixel densities and un-distorted tiling layout.
  const baseCanvasDimension = 1200;
  const canvasW = selectedPreset.ratio >= 1 
    ? baseCanvasDimension 
    : Math.round(baseCanvasDimension * selectedPreset.ratio);
  const canvasH = selectedPreset.ratio <= 1 
    ? baseCanvasDimension 
    : Math.round(baseCanvasDimension / selectedPreset.ratio);

  // Core canvas render cycle
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    // Clear and reset canvas transparency
    ctx.clearRect(0, 0, w, h);

    // Draw a single high-resolution biological composition perfectly sized to fill the viewport aspect ratio frame
    renderPatternTile(ctx, w, h, seasoning, config);
  }, [seasoning, config, canvasW, canvasH]);

  const updateParam = (key: keyof PatternConfig, value: number | string) => {
    onChangeConfig({
      ...config,
      [key]: value,
    });
  };

  const randomizeLayout = () => {
    const nextSeed = Math.floor(Math.random() * 100000) + 1;
    // Generate a fresh, visually calibrated layout strictly within curated safe bounds to prevent overcrowding
    const freshConfig = getCuratedConfigForSeasoning(
      seasoning.id,
      selectedPreset.ratio,
      config.themeMode,
      nextSeed
    );
    onChangeConfig(freshConfig);
  };

  const handleFrameSelect = (p: FramePreset) => {
    setSelectedPreset(p);
    // gridMode field removed (was dead — no renderer consumed it).
    // Frame ratio change still triggers canvas resize via the canvasW/canvasH effect.
  };

  // Direct vector SVG download handler that strictly respects frame format viewBox aspect ratios
  const downloadSVG = () => {
    // Set specific viewBox constraints so the vectors conform gracefully to the frame aspect ratio
    const baseSvgSize = 1200;
    const svgW = selectedPreset.ratio >= 1 
      ? baseSvgSize 
      : Math.round(baseSvgSize * selectedPreset.ratio);
    const svgH = selectedPreset.ratio <= 1 
      ? baseSvgSize 
      : Math.round(baseSvgSize / selectedPreset.ratio);

    const svgStr = generateSVGPatternString(seasoning, config, svgW, svgH);

    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ragga_${seasoning.id}_${selectedPreset.ratioStr.replace(':', '_')}_pattern.svg`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Direct heavy resolution PNG canvas downloader
  const downloadPNG = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = url;
    link.download = `ragga_${seasoning.id}_${selectedPreset.ratioStr.replace(':', '_')}_pattern.png`;
    link.click();
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-start" id="pattern-unified-workspace">
      
      {/* SECTION A: Artwork Hero and Core Specimen Slide (Col span 7 for dominant presence) */}
      <div className="lg:col-span-7 flex flex-col items-center">
        
        {/* Gallery / Specimen Slide Board - responsive square frame for consistent layout */}
        <div className="relative w-full aspect-square bg-[#EFECE5] rounded-lg p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-neutral-200 flex items-center justify-center select-none group">
          
          {/* Smooth fluid aspect ratio window simulating a photographic microscope slide */}
          <div className="relative w-full h-full overflow-hidden bg-white shadow-inner flex items-center justify-center rounded-sm">
            
            <div 
              className="relative w-full max-h-full rounded-sm overflow-hidden bg-white shadow-[inset_0_2px_8px_rgba(0,0,0,0.045)] border border-neutral-200/50 flex items-center justify-center transition-all duration-500 ease-out"
              style={{ 
                aspectRatio: `${selectedPreset.ratio}`,
              }}
            >
              <canvas
                ref={canvasRef}
                width={canvasW}
                height={canvasH}
                className="w-full h-full object-cover select-none transition-all duration-300"
                id="unified-square-viewport"
              />
            </div>
          </div>

        </div>

        {/* ⚡ THE PRIMARY EMOTIONAL ACTION: Giant Composition Generator */}
        <button
          onClick={randomizeLayout}
          className="w-full mt-6 py-4 px-6 bg-neutral-950 hover:bg-neutral-800 text-white rounded-lg text-xs font-bold tracking-[0.25em] transition-all duration-300 active:scale-[0.99] flex items-center justify-center gap-3 shadow-md border border-neutral-900 font-mono uppercase"
          id="btn-trigger-randomizer-primary"
        >
          <RefreshCw className="h-4 w-4 text-white animate-spin-slow" />
          Gerar Nova Composição (Randomizar)
        </button>

        {/* Quiet flat download triggers beneath generator */}
        <div className="w-full grid grid-cols-2 gap-3 mt-3">
          <button
            onClick={downloadPNG}
            className="flex items-center justify-center gap-2 py-2.5 px-4 bg-transparent border border-neutral-200 hover:border-neutral-400 hover:bg-white text-neutral-700 hover:text-neutral-950 rounded-lg text-xs font-semibold font-mono tracking-wider uppercase transition-all duration-200 active:scale-[0.98]"
            id="download-png-workspace-btn"
          >
            <Download className="h-3.5 w-3.5 text-neutral-400" />
            Exportar PNG
          </button>
          <button
            onClick={downloadSVG}
            className="flex items-center justify-center gap-2 py-2.5 px-4 bg-transparent border border-neutral-200 hover:border-neutral-400 hover:bg-white text-neutral-700 hover:text-neutral-950 rounded-lg text-xs font-semibold font-mono tracking-wider uppercase transition-all duration-200 active:scale-[0.98]"
            id="download-svg-workspace-btn"
          >
            <Download className="h-3.5 w-3.5 text-neutral-400" />
            Exportar SVG
          </button>
        </div>

      </div>

      {/* SECTION B: Property Control Column (Col span 5, clean quiet Figma-style parameters) */}
      <div className="lg:col-span-4 flex flex-col space-y-8 p-1">
        
        {/* Formato do Frame (Frame Preset System) - REDESIGNED BEAUTY */}
        <div className="space-y-3">
          <span className="text-[10px] font-mono font-extrabold tracking-[0.15em] text-neutral-400 uppercase block">
            Formato do Frame
          </span>

          <div className="flex gap-1.5 w-full" id="visual-frame-presets-strip">
            {FRAME_PRESETS.map((p) => {
              const isSelected = p.id === selectedPreset.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleFrameSelect(p)}
                  className={`flex flex-col items-center justify-center py-3.5 px-1 rounded-lg border text-center transition-all duration-300 relative focus:outline-none flex-1 group ${
                    isSelected
                      ? 'bg-neutral-950 border-neutral-950 text-white shadow-sm'
                      : 'bg-white hover:bg-neutral-50 border-neutral-200/70 text-neutral-500 hover:text-neutral-950 hover:border-neutral-300'
                  }`}
                  id={`frame-preset-${p.id}`}
                  title={`${p.name} (${p.ratioStr})`}
                >
                  {/* Miniature accurate aspect ratio box */}
                  <div className="h-5 flex items-center justify-center">
                    <div 
                      className={`border-[1.5px] rounded-[1.5px] transition-all duration-300 ${
                        isSelected 
                          ? 'border-white bg-white/20' 
                          : 'border-neutral-400 group-hover:border-neutral-700 bg-neutral-100'
                      }`}
                      style={{
                        width: p.ratio >= 1 ? '16px' : `${Math.round(16 * p.ratio)}px`,
                        height: p.ratio <= 1 ? '16px' : `${Math.round(16 / p.ratio)}px`,
                      }}
                    />
                  </div>

                  {/* Elegant human label */}
                  <span className="text-[8px] font-mono font-black tracking-widest mt-2 uppercase leading-none opacity-80">
                    {p.name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Tactile Visual Theme Swatches */}
        <div className="space-y-2">
          <label className="text-[10px] font-mono font-extrabold tracking-[0.15em] text-neutral-400 uppercase block">
            Tema
          </label>
          <div className="grid grid-cols-2 gap-3" id="tactile-theme-selector">
            {/* Light Swatch */}
            <button
              type="button"
              onClick={() => updateParam('themeMode', 'light')}
              className={`relative aspect-[3/1] rounded-lg overflow-hidden border p-3 transition-all duration-200 text-left flex items-center justify-between group ${
                config.themeMode === 'light'
                  ? 'border-neutral-950 ring-1 ring-neutral-950 bg-white'
                  : 'border-neutral-200 hover:border-neutral-300 bg-white/60'
              }`}
              id="workspace-theme-light"
            >
              <div className="flex flex-col">
                <span className="text-[11px] font-extrabold text-neutral-950 tracking-wide">Claro</span>
              </div>
              <div className="h-6 w-6 rounded-full bg-[#EFECE5] border border-neutral-200 flex items-center justify-center shrink-0">
                <div className="h-2 w-2 rounded-full bg-neutral-950/20" />
              </div>
              {config.themeMode === 'light' && (
                <div className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-neutral-950" />
              )}
            </button>

            {/* Dark Swatch */}
            <button
              type="button"
              onClick={() => updateParam('themeMode', 'dark')}
              className={`relative aspect-[3/1] rounded-lg overflow-hidden border p-3 transition-all duration-200 text-left flex items-center justify-between group ${
                config.themeMode === 'dark'
                  ? 'border-neutral-950 ring-1 ring-neutral-950 bg-neutral-950 text-white'
                  : 'border-neutral-200 hover:border-neutral-400 bg-neutral-100/50'
              }`}
              id="workspace-theme-dark"
            >
              <div className="flex flex-col">
                <span className="text-[11px] font-extrabold tracking-wide">Escuro</span>
              </div>
              <div 
                className="h-6 w-6 rounded-full border border-white/20 flex items-center justify-center shrink-0"
                style={{ backgroundColor: seasoning.primaryColor }}
              >
                <div className="h-2 w-2 rounded-full bg-white/60" />
              </div>
              {config.themeMode === 'dark' && (
                <div className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-white" />
              )}
            </button>
          </div>
        </div>

        {/* Master Tuning Sliders */}
        <div id="fine-tuning-parameters" className="space-y-6">
          <h3 className="text-[10px] font-mono font-extrabold tracking-[0.2em] text-neutral-400 uppercase flex items-center gap-2">
            <SlidersHorizontal className="h-3 w-3 text-neutral-400" />
            Parâmetros Morfológicos
          </h3>

          {/* Global sliders — read all metadata + range from the canonical PARAMETERS registry */}
          {PARAMETERS.zoom.visibleFor[seasoning.id as SpiceId] && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-[11px] font-medium text-neutral-800">
                <span className="flex items-center gap-1.5">
                  <ZoomIn className="h-3 w-3 text-neutral-400" /> {PARAMETERS.zoom.uiLabel}
                </span>
                <span className="font-mono text-neutral-500">{formatParamValue('zoom', config.zoom)}</span>
              </div>
              <input
                type="range"
                min={PARAMETERS.zoom.min}
                max={PARAMETERS.zoom.max}
                step={PARAMETERS.zoom.step}
                value={config.zoom}
                onChange={(e) => updateParam('zoom', parseFloat(e.target.value))}
                className="w-full accent-neutral-950 h-1 bg-neutral-200/70 rounded-full cursor-pointer"
              />
            </div>
          )}

          {PARAMETERS.density.visibleFor[seasoning.id as SpiceId] && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-[11px] font-medium text-neutral-800">
                <span>{PARAMETERS.density.uiLabel}</span>
                <span className="font-mono text-neutral-500">{formatParamValue('density', config.density)}</span>
              </div>
              <input
                type="range"
                min={PARAMETERS.density.min}
                max={PARAMETERS.density.max}
                step={PARAMETERS.density.step}
                value={config.density}
                onChange={(e) => updateParam('density', parseFloat(e.target.value))}
                className="w-full accent-neutral-950 h-1 bg-neutral-200/70 rounded-full cursor-pointer"
              />
            </div>
          )}

          {PARAMETERS.rotation.visibleFor[seasoning.id as SpiceId] && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-[11px] font-medium text-neutral-800">
                <span>{PARAMETERS.rotation.uiLabel}</span>
                <span className="font-mono text-neutral-500">{formatParamValue('rotation', config.rotation)}</span>
              </div>
              <input
                type="range"
                min={PARAMETERS.rotation.min}
                max={PARAMETERS.rotation.max}
                step={PARAMETERS.rotation.step}
                value={config.rotation}
                onChange={(e) => updateParam('rotation', parseFloat(e.target.value))}
                className="w-full accent-neutral-950 h-1 bg-neutral-200/70 rounded-full cursor-pointer"
              />
            </div>
          )}

          {/* Spice-accent sliders — same registry, accent color from seasoning */}
          {PARAMETERS.voronoiRoundedness.visibleFor[seasoning.id as SpiceId] && (
            <div
              className="space-y-1.5 pt-2 pb-1 border-t border-dashed border-neutral-200"
              id="voronoi-roundedness-container"
              style={{ borderColor: `${seasoning.primaryColor}40` }}
            >
              <div className="flex justify-between text-[11px] font-medium text-neutral-800">
                <span className="font-bold flex items-center gap-1.5" style={{ color: seasoning.primaryColor }}>
                  <Flame className="h-3 w-3" style={{ color: seasoning.primaryColor }} /> {PARAMETERS.voronoiRoundedness.uiLabel}
                </span>
                <span className="font-mono" style={{ color: seasoning.primaryColor }}>
                  {formatParamValue('voronoiRoundedness', config.voronoiRoundedness ?? PARAMETERS.voronoiRoundedness.defaults[seasoning.id as SpiceId])}
                </span>
              </div>
              <input
                type="range"
                min={PARAMETERS.voronoiRoundedness.min}
                max={PARAMETERS.voronoiRoundedness.max}
                step={PARAMETERS.voronoiRoundedness.step}
                value={config.voronoiRoundedness ?? PARAMETERS.voronoiRoundedness.defaults[seasoning.id as SpiceId]}
                onChange={(e) => updateParam('voronoiRoundedness', parseFloat(e.target.value))}
                className="w-full h-1 rounded-full cursor-pointer"
                style={{ accentColor: seasoning.primaryColor }}
                id="voronoi-roundedness-slider"
              />
            </div>
          )}

          {PARAMETERS.lineWidth.visibleFor[seasoning.id as SpiceId] && (
            <div
              className="space-y-1.5 pt-2 pb-1 border-t border-dashed border-neutral-200"
              style={{ borderColor: `${seasoning.primaryColor}40` }}
            >
              <div className="flex justify-between text-[11px] font-medium text-neutral-800">
                <span className="font-bold flex items-center gap-1.5" style={{ color: seasoning.primaryColor }}>
                  <Flame className="h-3 w-3" style={{ color: seasoning.primaryColor }} /> {PARAMETERS.lineWidth.uiLabel}
                </span>
                <span className="font-mono" style={{ color: seasoning.primaryColor }}>
                  {formatParamValue('lineWidth', config.lineWidth ?? PARAMETERS.lineWidth.defaults[seasoning.id as SpiceId])}
                </span>
              </div>
              <input
                type="range"
                min={PARAMETERS.lineWidth.min}
                max={PARAMETERS.lineWidth.max}
                step={PARAMETERS.lineWidth.step}
                value={config.lineWidth ?? PARAMETERS.lineWidth.defaults[seasoning.id as SpiceId]}
                onChange={(e) => updateParam('lineWidth', parseFloat(e.target.value))}
                className="w-full h-1 rounded-full cursor-pointer"
                style={{ accentColor: seasoning.primaryColor }}
              />
            </div>
          )}

        </div>

      </div>

    </div>
  );
}
