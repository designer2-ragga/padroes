# Padrões Ragga — Figma Plugin

Plugin privado do Figma para gerar padrões micro-microscópicos das verticais do Grupo Ragga diretamente no canvas, como vetores nativos editáveis.

## Como instalar (privado, local)

Você precisa do Figma desktop (web não suporta plugins locais).

1. Abra o **Figma desktop**
2. No menu superior:
   `Plugins` → `Development` → `Import plugin from manifest…`
3. Selecione o arquivo:
   ```
   Gerador-de-Micro-Patterns-Ragga/figma-plugin/manifest.json
   ```
4. Pronto. O plugin aparece em `Plugins` → `Development` → `Padrões Ragga`

## Como usar

1. Abra qualquer arquivo Figma
2. Menu: `Plugins` → `Development` → `Padrões Ragga`
3. Janela do plugin abre com o gerador completo:
   - Selecione um spice (Sal, Louro, Alho, Pimenta, Manjericão, Orégano)
   - Ajuste sliders (zoom, densidade, parâmetros contextuais)
   - Escolha aspect ratio (Quadrado, Paisagem, Cinema, Retrato, Story)
   - Tema claro/escuro
4. Clique **"Inserir no Figma"**
5. O padrão é inserido no canvas como **frame vetorial nativo** centrado no viewport, já selecionado

Cada elemento (folha, célula, círculo, polígono) vira um **node editável** dentro do frame inserido — você pode mexer, recolorir, reorganizar diretamente no Figma.

## O que o plugin NÃO inclui

- Shaders (ASCII/Halftone) — esses são pós-processos raster, ficaram só na versão web
- Botões de export PNG/SVG — substituídos pela inserção direta no canvas

## Re-build (depois de mudanças no código fonte)

```bash
npm run build:plugin
```

Isso regera:
- `figma-plugin/ui.html` (interface React inlinada num único arquivo)
- `figma-plugin/code.js` (plugin thread, ~30 linhas)

Depois é só recarregar o plugin no Figma:
- `Plugins` → `Development` → `Padrões Ragga` (recarrega automaticamente)

## Estrutura

```
figma-plugin/
├── manifest.json   # registro do plugin
├── ui.html         # iframe com React app inlinada (~340 KB)
├── code.js         # plugin thread sandbox
└── src/
    └── code.ts     # fonte TS do thread
```

## URL da versão web

A mesma engine também roda na web em:
**https://ragga-patterns.netlify.app**

Web tem export PNG/SVG e shaders. Plugin tem inserção nativa no Figma.
