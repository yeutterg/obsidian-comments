"use client";

import { useEffect, useSyncExternalStore } from "react";
import { MonitorIcon, MoonIcon, SunIcon } from "./Icons";

type Theme = "system" | "light" | "dark";
type ThemeToggleVariant = "icon" | "menu";

const ORDER: Theme[] = ["system", "light", "dark"];
const THEME_EVENT = "obsidian-comments-theme-change";

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "dark") {
    root.classList.add("dark");
    return;
  }
  if (theme === "light") {
    root.classList.remove("dark");
    return;
  }

  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  root.classList.toggle("dark", prefersDark);
}

function readStoredTheme(): Theme {
  if (typeof window === "undefined") {
    return "system";
  }

  const stored = localStorage.getItem("theme");
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
}

function subscribeToThemeChange(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key && event.key !== "theme") {
      return;
    }
    onStoreChange();
  };
  const handleThemeEvent = () => onStoreChange();

  window.addEventListener("storage", handleStorage);
  window.addEventListener(THEME_EVENT, handleThemeEvent);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(THEME_EVENT, handleThemeEvent);
  };
}

export default function ThemeToggle({
  variant = "icon",
}: {
  variant?: ThemeToggleVariant;
}) {
  const theme = useSyncExternalStore<Theme>(subscribeToThemeChange, readStoredTheme, (): Theme => "system");

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (theme !== "system") {
      return;
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => applyTheme("system");
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, [theme]);

  const nextTheme = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
  const Icon = theme === "dark" ? MoonIcon : theme === "light" ? SunIcon : MonitorIcon;
  const themeLabel = theme.charAt(0).toUpperCase() + theme.slice(1);

  return (
    <button
      type="button"
      className={variant === "menu" ? "mobile-action-menu-item" : "icon-button"}
      onClick={() => {
        localStorage.setItem("theme", nextTheme);
        window.dispatchEvent(new Event(THEME_EVENT));
      }}
      aria-label={`Theme: ${theme}. Switch to ${nextTheme}.`}
      title={`Theme: ${theme}`}
    >
      <Icon width={16} height={16} />
      {variant === "menu" ? <span>Theme: {themeLabel}</span> : null}
    </button>
  );
}
