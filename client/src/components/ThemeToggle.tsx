import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const nextTheme = theme === "dark" ? "light" : "dark";

  return <button
    type="button"
    className="theme-toggle inline-flex size-9 items-center justify-center rounded-xl border border-[#d8d3c7] bg-white text-[#14212b] transition hover:bg-[#fff7ea] active:scale-[0.97] sm:size-10"
    onClick={() => toggleTheme?.()}
    aria-label={`Switch to ${nextTheme} mode`}
    title={`Switch to ${nextTheme} mode`}
  >
    {theme === "dark" ? <Sun className="size-4 sm:size-5" aria-hidden="true" /> : <Moon className="size-4 sm:size-5" aria-hidden="true" />}
  </button>;
}
