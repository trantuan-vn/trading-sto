'use client';

import type { ReactNode } from 'react';

import { RainbowKitProvider, lightTheme, darkTheme } from '@rainbow-me/rainbowkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';

import { usePreferencesStore } from '@/stores/preferences/preferences-provider';
import { ThemeMode, ThemePreset, THEME_PRESET_OPTIONS } from '@/types/preferences/theme';

import { config } from '../../config/wagmi-config';

// Single QueryClient instance to prevent re-instantiation
const queryClient = new QueryClient();

// Lookup table for accentColorForeground based on themePreset and themeMode
const foregroundColors: Record<ThemePreset, { light: string; dark: string }> = {
  default: {
    light: 'oklch(0.95 0.02 0)', // Near-white for light mode
    dark: 'oklch(0.1 0.02 0)',  // Near-black for dark mode
  },
  brutalist: {
    light: 'oklch(0.3 0.05 0)',     // Dark gray for light mode
    dark: 'oklch(0.85 0.05 60)',    // Warm off-white for dark mode
  },
  'soft-pop': {
    light: 'oklch(0.25 0.1 240)',   // Deep navy for light mode
    dark: 'oklch(0.75 0.15 180)',   // Vibrant cyan for dark mode
  },
  tangerine: {
    light: 'oklch(0.3 0.1 220)',    // Dark blue-gray for light mode
    dark: 'oklch(0.7 0.15 200)',    // Bright blue for dark mode
  },
};

// Maps themeMode and themePreset to RainbowKit themes
const getRainbowTheme = (themeMode: ThemeMode, themePreset: ThemePreset) => {
  // Find the preset configuration, fallback to default
  const preset = THEME_PRESET_OPTIONS.find((option) => option.value === themePreset) ?? THEME_PRESET_OPTIONS[0];

  // Select primary color and base theme
  const primaryColor = themeMode === 'dark' ? preset.primary.dark : preset.primary.light;
  const baseTheme = themeMode === 'dark' ? darkTheme() : lightTheme();

  // Get foreground color from lookup table
  const accentColorForeground = foregroundColors[themePreset]?.[themeMode] ?? foregroundColors.default[themeMode];

  return {
    ...baseTheme,
    colors: {
      ...baseTheme.colors,
      accentColor: primaryColor,
      accentColorForeground,
    },
  };
};

export function RainbowProvider({ children }: { children: ReactNode }) {
  // Select themeMode and themePreset from Zustand store
  const themeMode = usePreferencesStore((state) => state.themeMode);
  const themePreset = usePreferencesStore((state) => state.themePreset);

  const theme = getRainbowTheme(themeMode, themePreset);

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={theme}>{children}</RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}