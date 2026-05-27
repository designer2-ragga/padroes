/**
 * Vite config variant for the Figma plugin UI.
 * Produces a single self-contained HTML file (all JS + CSS inlined) at
 * `figma-plugin/ui.html`. Assets (the SVG icons used by the React UI) are
 * inlined as base64 so the plugin doesn't need external file access.
 */

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig(() => ({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  define: {
    // Compile-time flag so the React app can swap export buttons for "Insert into Figma"
    '__RAGGA_FIGMA_PLUGIN__': JSON.stringify(true),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  build: {
    outDir: 'figma-plugin-build',
    emptyOutDir: true,
    assetsInlineLimit: 100000000, // inline everything
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
}));
