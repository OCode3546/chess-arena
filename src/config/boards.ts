export interface BoardTheme {
  id: string;
  name: string;
  light: string;
  dark: string;
  /** Text colour for coordinates on light / dark squares. */
  coordLight: string;
  coordDark: string;
}

export const BOARD_THEMES: BoardTheme[] = [
  {
    id: 'classic-wood',
    name: 'Classic Wood',
    light: '#f0d9b5',
    dark: '#b58863',
    coordLight: '#8b5e3c',
    coordDark: '#f7e7cc',
  },
  {
    id: 'slate',
    name: 'Slate',
    light: '#d9dee8',
    dark: '#6b7a93',
    coordLight: '#4f5d75',
    coordDark: '#eef1f6',
  },
  {
    id: 'emerald',
    name: 'Emerald',
    light: '#e6efd9',
    dark: '#5e9a6e',
    coordLight: '#3f7a50',
    coordDark: '#eef6e6',
  },
  {
    id: 'midnight',
    name: 'Midnight',
    light: '#9aa6c7',
    dark: '#3b4466',
    coordLight: '#2a3150',
    coordDark: '#c9d1ea',
  },
  {
    id: 'neon',
    name: 'Neon',
    light: '#2b2f4a',
    dark: '#171a2e',
    coordLight: '#e879f9',
    coordDark: '#22d3ee',
  },
  {
    id: 'marble',
    name: 'Marble',
    light: '#eeeae4',
    dark: '#a39e97',
    coordLight: '#6f6a63',
    coordDark: '#f7f4ef',
  },
];

export const boardTheme = (id: string): BoardTheme =>
  BOARD_THEMES.find((b) => b.id === id) ?? BOARD_THEMES[0]!;
