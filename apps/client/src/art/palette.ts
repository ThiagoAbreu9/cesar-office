/** Paleta do escritório (06 §5), estendida para a arte provisória gerada em código. */
export const P = {
  ink: '#1B1F2A',
  deep: '#2E3442',
  steel: '#4A5163',
  slate: '#6E7689',
  mist: '#A3AABA',
  paper: '#F4F1EA',
  plaster: '#E4DED1',
  plasterShade: '#CFC7B6',
  woodDark: '#5C3A2E',
  wood: '#8A5A3C',
  woodLight: '#C08552',
  oak: '#D2AE82',
  oakShade: '#B98F63',
  ipe: '#E9B82C',
  ipeDark: '#B98A12',
  room: '#2F6FEB',
  leaf: '#4FA36B',
  leafDark: '#2F7A4B',
  leafLight: '#86C98A',
  glass: '#9CC6E8',
  glassLight: '#D4ECFA',
  screen: '#3F7FE0',
  screenGlow: '#9CC9FF',
  red: '#D9534F',
  white: '#FFFFFF',
} as const;

/** Tons de pele (look.body). */
export const SKINS = [
  { base: '#F2C9A5', shade: '#D9A982' },
  { base: '#E0A980', shade: '#C08660' },
  { base: '#B97A54', shade: '#99603E' },
  { base: '#7A4A2E', shade: '#5E3620' },
] as const;

/** Cores de roupa (look.outfit). */
export const OUTFITS = [
  { shirt: '#2F6FEB', pants: '#2E3442', name: 'Azul' },
  { shirt: '#E9B82C', pants: '#3B4254', name: 'Ipê' },
  { shirt: '#4FA36B', pants: '#2E3442', name: 'Verde' },
  { shirt: '#E0685A', pants: '#3B4254', name: 'Coral' },
  { shirt: '#7C5CC4', pants: '#2E3442', name: 'Roxo' },
  { shirt: '#5B6475', pants: '#6B5440', name: 'Moletom' },
] as const;

/** look.hair = estilo + 5 × cor. */
export const HAIR_STYLES = ['Curto', 'Longo', 'Cacheado', 'Coque', 'Rabo'] as const;
export const HAIR_COLORS = ['#2B2118', '#6B4226', '#C9973A'] as const;

export function decodeHair(hair: number): { style: number; color: string } {
  const style = hair % HAIR_STYLES.length;
  const color = HAIR_COLORS[Math.floor(hair / HAIR_STYLES.length) % HAIR_COLORS.length] ?? HAIR_COLORS[0];
  return { style, color };
}

export const encodeHair = (style: number, color: number): number => style + HAIR_STYLES.length * color;
