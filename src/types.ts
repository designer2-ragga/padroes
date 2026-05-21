/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Seasoning {
  id: string;
  name: string;
  emoji: string;
  division: string;
  description: string;
  primaryColor: string; // The specific brand colors provided by user
  secondaryColor: string; // Complementary color for high depth
  metaphor: string; // Explanation of why the condiment matches the department
}

export interface PatternConfig {
  zoom: number;          // 40 to 1200 (x magnification)
  density: number;       // 2 to 40 (structures per viewport)
  rotation: number;      // 0 to 180 (degrees, internal anisotropy axis only)
  lineWidth: number;     // 0.5 to 6.0 (px, absolute pixel stroke thickness)
  themeMode: 'light' | 'dark';
  voronoiRoundedness: number;    // 0 to 100 (% of corner rounding for Voronoi cells, applied via cubic ease-in)
  layoutSeed: number;            // deterministic layout seed
}

// NOTE: per-spice parameter presets now live in src/engine/parameters.ts (PARAMETERS registry).
// types.ts is type-only and brand-only.

export const TEMPEROS_RAGGA: Seasoning[] = [
  {
    id: 'sal',
    name: 'Sal',
    emoji: '🧂',
    division: 'Ragga Restaurantes',
    description: 'Operação que sustenta o Grupo. Em tudo. Todo dia. Em toda mesa.',
    primaryColor: '#B81A20',
    secondaryColor: '#FF6B6B',
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
    metaphor: 'O orégano é a erva seca com alta estabilidade olfativa e gustativa, o tempero universal das pizzarias francesas e italianas. Simboliza a franquia: altamente transportável, idêntica na matriz e na filial, replicando o mesmo sucesso.'
  }
];

