"use strict";
/**
 * Plugin main thread — runs in Figma sandbox.
 * Listens for SVG payloads from the UI iframe and inserts them as native
 * vector frames at the viewport center.
 */
figma.showUI(__html__, {
    width: 920,
    height: 720,
    themeColors: true,
    title: 'Padrões Ragga',
});
figma.ui.onmessage = async (msg) => {
    if (msg.type === 'insert-svg') {
        try {
            const node = figma.createNodeFromSvg(msg.svg);
            node.name = msg.name || 'Padrão Ragga';
            // Center on current viewport
            const cx = figma.viewport.center.x;
            const cy = figma.viewport.center.y;
            node.x = cx - node.width / 2;
            node.y = cy - node.height / 2;
            figma.currentPage.selection = [node];
            figma.viewport.scrollAndZoomIntoView([node]);
            figma.notify(`Inserido: ${node.name}`);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : 'Erro desconhecido';
            figma.notify(`Falha ao inserir: ${message}`, { error: true });
        }
    }
    else if (msg.type === 'close') {
        figma.closePlugin();
    }
};
