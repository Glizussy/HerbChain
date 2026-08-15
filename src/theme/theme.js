// src/theme/theme.js
// Shared design tokens for AyurSutra / HerbChain

export const colors = {
  bg: '#F7F5EF',        // warm off-white, paper-like
  surface: '#FFFFFF',
  primary: '#2F6A3F',    // deep herbal green
  primaryDark: '#204A2C',
  accent: '#C77D2E',     // turmeric/terracotta accent
  text: '#1F2A22',
  textMuted: '#6B7568',
  border: '#E1DED2',
  error: '#B3261E',
  success: '#2F6A3F',
  inputBg: '#FFFFFF',
  chipBg: '#EEF3EA',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 20,
  pill: 999,
};

export const typography = {
  h1: { fontSize: 24, fontWeight: '700', color: colors.text },
  h2: { fontSize: 18, fontWeight: '700', color: colors.text },
  label: { fontSize: 13, fontWeight: '600', color: colors.textMuted, letterSpacing: 0.3 },
  body: { fontSize: 15, color: colors.text },
  hint: { fontSize: 12, color: colors.textMuted },
};
