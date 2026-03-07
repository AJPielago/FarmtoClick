import { Platform } from 'react-native';

export const COLORS = {
  primary: '#2E7D32', // Darker, richer green
  primaryLight: '#4CAF50', // Standard green
  primaryPale: '#E8F5E9', // Very light green background
  accent: '#FFC107', // Amber/Gold for stars/highlights
  background: '#FAFAFA', // Very clean white-grey
  surface: '#FFFFFF',
  text: '#1C1C1E', // Apple-style almost black
  textSecondary: '#6E6E73',
  textLight: '#AEAEB2',
  error: '#FF3B30',
  success: '#34C759',
  border: '#F2F2F7',
  white: '#FFFFFF',
  black: '#000000',
  transparent: 'transparent',
  shadow: '#000000',
};

export const SPACING = {
  xs: 4,
  s: 8,
  m: 16,
  l: 24,
  xl: 32,
  xxl: 48,
};

export const BORDER_RADIUS = {
  s: 6,
  m: 12,
  l: 20,
  xl: 32,
  round: 999,
};

export const SHADOWS = {
  soft: {
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  medium: {
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 6,
  },
  strong: {
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 10,
  },
};

export const TYPOGRAPHY = {
  h1: { fontSize: 32, fontWeight: '800', letterSpacing: -0.5, color: COLORS.text },
  h2: { fontSize: 24, fontWeight: '700', letterSpacing: -0.5, color: COLORS.text },
  h3: { fontSize: 20, fontWeight: '600', color: COLORS.text },
  subtitle: { fontSize: 16, fontWeight: '500', color: COLORS.textSecondary },
  body: { fontSize: 15, lineHeight: 22, color: COLORS.text },
  caption: { fontSize: 12, color: COLORS.textSecondary },
  button: { fontSize: 16, fontWeight: '700', letterSpacing: 0.5 },
};




