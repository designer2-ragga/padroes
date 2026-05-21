/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type PatternGridMode = 'grid' | 'half-drop' | 'brick' | 'mirror';

export interface Seasoning {
  id: string;
  name: string;
  emoji: string;
  division: string;
  description: string;
  primaryColor: string; // The specific brand colors provided by user
  secondaryColor: string; // Complementary color for high depth
  particleType: 'crystal_cube' | 'extended_leaf_cell' | 'concentric_bulb_starch' | 'fiery_droplet_spike' | 'glandular_basil_hair' | 'oregano_pollen_pod';
  metaphor: string; // Explanation of why the condiment matches the department
}

export interface PatternConfig {
  zoom: number;          // 100 to 1000 (%)
  density: number;       // 10 to 60 (particle multiplier count)
  rotation: number;      // 0 to 360 (degrees)
  noise: number;         // 0 to 100 (camera grain noise)
  lineWidth: number;     // 1 to 5 (particle line thickness)
  fillAlpha: number;     // 0 to 100 (%)
  lightingAngle: number; // 0 to 360
  gridScale: number;     // 10 to 150 (pixel size of one tile)
  gridMode: PatternGridMode;
  themeMode: 'light' | 'dark';
  voronoiRoundedness: number;    // 0 to 100 (% of corner rounding for Voronoi cells)
  layoutSeed: number;            // deterministic layout seed
}

export interface MockupPreset {
  id: string;
  name: string;
  category: 'printing' | 'apparel' | 'digital' | 'packaging';
  description: string;
}

// Per-spice parameter presets (realistic microscopic scaling)
export interface ParameterPreset {
  zoom: { default: number; min: number; max: number };
  density: { default: number; min: number; max: number };
  rotation: { default: number; min: number; max: number };
  lineWidth: { default: number; min: number; max: number };
  voronoiRoundedness: { default: number; min: number; max: number };
}

export const PARAMETER_PRESETS: Record<string, ParameterPreset> = {
  sal: {
    zoom: { default: 120, min: 40, max: 1200 },
    density: { default: 18, min: 2, max: 40 },
    rotation: { default: 0, min: 0, max: 180 },
    lineWidth: { default: 1.6, min: 0.5, max: 6 },
    voronoiRoundedness: { default: 0, min: 0, max: 100 }, // crystalline
  },
  louro: {
    zoom: { default: 220, min: 40, max: 1200 },
    density: { default: 9, min: 2, max: 40 },
    rotation: { default: 0, min: 0, max: 180 },
    lineWidth: { default: 2.2, min: 0.5, max: 6 },
    voronoiRoundedness: { default: 44, min: 0, max: 100 },
  },
  alho: {
    zoom: { default: 180, min: 40, max: 1200 },
    density: { default: 14, min: 2, max: 40 },
    rotation: { default: 0, min: 0, max: 180 },
    lineWidth: { default: 1.4, min: 0.5, max: 6 },
    voronoiRoundedness: { default: 28, min: 0, max: 100 },
  },
  pimenta: {
    zoom: { default: 340, min: 40, max: 1200 },
    density: { default: 22, min: 2, max: 40 },
    rotation: { default: 0, min: 0, max: 180 },
    lineWidth: { default: 1.8, min: 0.5, max: 6 },
    voronoiRoundedness: { default: 52, min: 0, max: 100 },
  },
  manjericao: {
    zoom: { default: 260, min: 40, max: 1200 },
    density: { default: 16, min: 2, max: 40 },
    rotation: { default: 0, min: 0, max: 180 },
    lineWidth: { default: 1.5, min: 0.5, max: 6 },
    voronoiRoundedness: { default: 40, min: 0, max: 100 },
  },
  oregano: {
    zoom: { default: 140, min: 40, max: 1200 },
    density: { default: 28, min: 2, max: 40 },
    rotation: { default: 0, min: 0, max: 180 },
    lineWidth: { default: 1.3, min: 0.5, max: 6 },
    voronoiRoundedness: { default: 35, min: 0, max: 100 },
  },
};

export const TEMPEROS_RAGGA: Seasoning[] = [
  {
    id: 'sal',
    name: 'Sal',
    emoji: '🧂',
    division: 'Ragga Restaurantes',
    description: 'Operação que sustenta o Grupo. Em tudo. Todo dia. Em toda mesa.',
    primaryColor: '#B81A20',
    secondaryColor: '#FF6B6B',
    particleType: 'crystal_cube',
    metaphor: 'O sal é a base indispensável de qualquer prato. Ele realça todos os outros sabores e está presente em todas as fases da operação, sustentando o paladar e o negócio diariamente.'
  },
  {
    id: 'louro',
    name: 'Louro',
    emoji: '🌿',
    division: 'Ragga Gestão & Educação',
    description: 'Perfuma a panela inteira sem aparecer. RH, Financeiro, Operações, TI, Treinamentos.',
    primaryColor: '#1E40AF',
    secondaryColor: '#60A5FA',
    particleType: 'extended_leaf_cell',
    metaphor: 'Uma única folha de louro perfuma de forma contínua e discreta um guisado inteiro. Assim é a gestão e os bastidores corporativos — discreto, mas sua força aromatiza e viabiliza toda a estrutura.'
  },
  {
    id: 'alho',
    name: 'Alho',
    emoji: '🧄',
    division: 'Ragga Insumos',
    description: 'Raiz, base, brasilidade. Primeira coisa a entrar na panela.',
    primaryColor: '#D4A010',
    secondaryColor: '#FBBF24',
    particleType: 'concentric_bulb_starch',
    metaphor: 'O alho é a base de refogado mais tradicional da culinária brasileira. Ele representa os insumos brutos de qualidade, os fundamentos que entram primeiro e preparam o terreno para o sucesso.'
  },
  {
    id: 'pimenta',
    name: 'Pimenta',
    emoji: '🌶️',
    division: 'Ragga MKT + Vendas',
    description: 'Dá gás. Queima. Marca presença. A agência que acende o fogo.',
    primaryColor: '#E86820',
    secondaryColor: '#FDBA74',
    particleType: 'fiery_droplet_spike',
    metaphor: 'A pimenta eleva a temperatura corporal, adiciona intensidade marcante e estimula os sentidos. Representa a força do marketing que gera atração, acelera vendas e estimula o crescimento.'
  },
  {
    id: 'manjericao',
    name: 'Manjericão',
    emoji: '🌱',
    division: 'Ragga Social',
    description: 'Folha do bem, planta da casa. Pouco insumo, muito impacto.',
    primaryColor: '#8A2040',
    secondaryColor: '#EDA9BD',
    particleType: 'glandular_basil_hair',
    metaphor: 'O manjericão cresce com facilidade no quintal de casa, espalhando frescor e vitalidade generosa. É o impacto socioambiental, a folha do bem que eleva a alma e traz sustentabilidade ao ecossistema.'
  },
  {
    id: 'oregano',
    name: 'Orégano',
    emoji: '🌿',
    division: 'Ragga Franquia',
    description: 'O sabor não muda da matriz à unidade. Universal, seco, transportável.',
    primaryColor: '#93B629',
    secondaryColor: '#D4EC7F',
    particleType: 'oregano_pollen_pod',
    metaphor: 'O orégano é a erva seca com alta estabilidade olfativa e gustativa, o tempero universal das pizzarias francesas e italianas. Simboliza a franquia: altamente transportável, idêntica na matriz e na filial, replicando o mesmo sucesso.'
  }
];

export const MOCKUP_PRESETS: MockupPreset[] = [
  {
    id: 'menu',
    name: 'Cardápio de Restaurante',
    category: 'printing',
    description: 'Design editorial do cardápio oficial, utilizando a estampa como moldura e detalhe de rodapé.'
  },
  {
    id: 'stationery',
    name: 'Papel Timbrado do Grupo',
    category: 'printing',
    description: 'Papelaria executiva minimalista, com a estampa aplicada num delicado relevo seco ou marca d\'água.'
  },
  {
    id: 'packaging',
    name: 'Embalagem de Condimentos',
    category: 'packaging',
    description: 'Tubos ou sacos kraft de especiarias estampando o padrão como grafismo identificador principal.'
  },
  {
    id: 'apron',
    name: 'Avental / Uniforme',
    category: 'apparel',
    description: 'Visualização da estampa aplicada nas alças, bolso central ou corpo inteiro do avental da brigada.'
  },
  {
    id: 'screen',
    name: 'Wallpaper Corporativo (Laptop)',
    category: 'digital',
    description: 'Aplicação elegante como fundo de tela de alta resolução para notebooks e tablets dos franqueados.'
  },
  {
    id: 'combined-mural',
    name: 'Mural de Entrada do Grupo',
    category: 'printing',
    description: 'Painel geométrico gigante combinando as 6 estampas em um mosaico unificado na sede administrativa.'
  }
];
