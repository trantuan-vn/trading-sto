"use client";

import type { ReactNode } from "react";

import { RainbowKitProvider, lightTheme, darkTheme, Locale } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useLocale } from "next-intl";
import { WagmiProvider } from "wagmi";

import { usePreferencesStore } from "@/stores/preferences/preferences-provider";
import { ThemeMode, ThemePreset, THEME_PRESET_OPTIONS } from "@/types/preferences/theme";

import { config } from "../../config/wagmi-config";

// Single QueryClient instance to prevent re-instantiation
const queryClient = new QueryClient();

// Maps themeMode and themePreset to RainbowKit themes
const getRainbowTheme = (themeMode: ThemeMode, themePreset: ThemePreset) => {
  // Find the preset configuration, fallback to default
  const preset = THEME_PRESET_OPTIONS.find((option) => option.value === themePreset) ?? THEME_PRESET_OPTIONS[0];

  // Select primary color and base theme
  const primaryColor = themeMode === "dark" ? preset.primary.dark : preset.primary.light;
  const baseTheme = themeMode === "dark" ? darkTheme() : lightTheme();
  // tự chọn foreground dựa vào themeMode
  // const accentColorForeground = themeMode === "dark" ? "black" : "white";
  const accentColorForeground =
    typeof window !== "undefined"
      ? getComputedStyle(document.documentElement).getPropertyValue("--accent-color-foreground").trim() || (themeMode === "dark" ? "black" : "white")
      : (themeMode === "dark" ? "black" : "white");

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
  const locale = useLocale();
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider locale={locale as Locale} theme={theme}>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}