/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { TEMPEROS_RAGGA, Seasoning, PatternConfig } from './types';
import PatternWorkspace from './components/PatternWorkspace';
import { getCuratedConfigForSeasoning } from './utils/patternRenderer';

// Asset imports — Vite inlines these for the Figma plugin (single-file build)
// and serves them as URLs for the web build. Same code path for both.
import grupoLogo from '/public/assets/grupo-logo.svg?url';
import iconSal from '/public/assets/icon-sal.svg?url';
import iconLouro from '/public/assets/icon-louro.svg?url';
import iconAlho from '/public/assets/icon-alho.svg?url';
import iconPimenta from '/public/assets/icon-pimenta.svg?url';
import iconManjericao from '/public/assets/icon-manjericao.svg?url';
import iconOregano from '/public/assets/icon-oregano.svg?url';

const SPICE_ICONS: Record<string, string> = {
  sal: iconSal,
  louro: iconLouro,
  alho: iconAlho,
  pimenta: iconPimenta,
  manjericao: iconManjericao,
  oregano: iconOregano,
};

export default function App() {
  const [selectedSeasoning, setSelectedSeasoning] = useState<Seasoning>(TEMPEROS_RAGGA[5]); // Selected Oregano by default
  
  // Master microscope & pattern configuration initialized with optimal composition rules
  const [config, setConfig] = useState<PatternConfig>(() => 
    getCuratedConfigForSeasoning(TEMPEROS_RAGGA[5].id, 1.0, 'light', 1)
  );

  const handleSelectSeasoning = (seasoning: Seasoning) => {
    setSelectedSeasoning(seasoning);
    // Always reset to light theme on seasoning selection
    setConfig(prev => getCuratedConfigForSeasoning(seasoning.id, 1.0, 'light', prev.layoutSeed));
  };

  return (
    <div className="min-h-screen bg-[#F6F5F0] text-neutral-950 flex flex-col font-sans transition-all duration-300 selection:bg-neutral-900 selection:text-white" id="ragga-minimal-app">
      
      {/* 1. Minimal Quiet Editorial Header */}
      <header className="pt-8 pb-4 px-6 md:px-12 bg-[#F6F5F0]">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-baseline md:justify-between gap-2 border-b border-neutral-200/60 pb-5">
          <div className="space-y-1">
            <img
              src={grupoLogo}
              alt="Grupo Ragga"
              className="h-7 w-auto"
            />
            <p className="text-[10px] font-mono tracking-widest text-neutral-400 uppercase leading-none">
              IDENTIDADE MICROSCÓPICA DAS VERTICAIS
            </p>
          </div>

          <div className="flex items-center gap-2 md:self-end">
            <span className="text-[10px] font-mono tracking-wider uppercase text-neutral-400">
              PADRÃO DA IDENTIDADE:
            </span>
            <span 
              className="text-[10px] font-mono font-bold uppercase py-0.5 px-2 rounded"
              style={{ backgroundColor: `${selectedSeasoning.primaryColor}15`, color: selectedSeasoning.primaryColor }}
            >
              {selectedSeasoning.name}
            </span>
          </div>
        </div>
      </header>

      {/* 2. Main content viewport */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 md:px-12 pb-16 space-y-8" id="workspace-main-content">
        
        {/* Compact, clean horizontal Selection Area (Specimen Selector) */}
        <section className="flex justify-center" id="minimalist-seasoning-picker">
          <div className="flex flex-wrap gap-1.5 justify-center py-2 bg-neutral-200/30 p-1.5 rounded-full border border-neutral-200/50">
            {TEMPEROS_RAGGA.map((t) => {
              const isSelected = t.id === selectedSeasoning.id;
              return (
                <button
                  key={t.id}
                  onClick={() => handleSelectSeasoning(t)}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-medium tracking-wide transition-all duration-200 flex items-center gap-1.5 focus:outline-none hover:scale-102 ${
                    isSelected
                      ? 'text-white shadow-sm font-bold'
                      : 'text-neutral-500 hover:text-neutral-950'
                  }`}
                  style={
                    isSelected 
                      ? { backgroundColor: t.primaryColor } 
                      : {}
                  }
                  id={`seasoning-btn-${t.id}`}
                >
                  <img
                    src={SPICE_ICONS[t.id]}
                    alt=""
                    aria-hidden="true"
                    className={`h-5 w-auto shrink-0 ${isSelected ? 'brightness-0 invert' : ''}`}
                  />
                  <span className="font-display text-[11px] font-medium uppercase tracking-wider">{t.name}</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Unified workspace pattern tool */}
        <section id="pattern-generator-panel" className="pt-2">
          <PatternWorkspace 
            seasoning={selectedSeasoning}
            config={config}
            onChangeConfig={setConfig}
          />
        </section>

      </main>

    </div>
  );
}
