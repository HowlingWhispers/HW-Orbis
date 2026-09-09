import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';

export type ThemePreference = 'auto' | 'dark' | 'light';
type ResolvedTheme = 'dark' | 'light';

const STORAGE_KEY = 'coda.theme';
const DIM_MS = 180;
const RELEASE_MS = 620;

interface ThemeValue {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

function readStoredPreference(): ThemePreference {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === 'dark' || stored === 'light' || stored === 'auto' ? stored : 'auto';
}

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStoredPreference);
  const [systemDark, setSystemDarkState] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const transitionTimers = useRef<number[]>([]);

  const clearTransitionTimers = () => {
    transitionTimers.current.forEach((timer) => window.clearTimeout(timer));
    transitionTimers.current = [];
  };

  const runDimmerTransition = (applyChange: () => void) => {
    const root = document.documentElement;
    clearTransitionTimers();

    if (prefersReducedMotion()) {
      root.removeAttribute('data-theme-transition');
      applyChange();
      return;
    }

    root.dataset.themeTransition = 'dimming';

    const swapTimer = window.setTimeout(() => {
      applyChange();
      requestAnimationFrame(() => {
        root.dataset.themeTransition = 'brightening';
      });

      const cleanupTimer = window.setTimeout(() => {
        root.removeAttribute('data-theme-transition');
      }, RELEASE_MS);
      transitionTimers.current.push(cleanupTimer);
    }, DIM_MS);

    transitionTimers.current.push(swapTimer);
  };

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => {
      if (preference !== 'auto') {
        setSystemDarkState(event.matches);
        return;
      }

      runDimmerTransition(() => setSystemDarkState(event.matches));
    };

    media.addEventListener('change', onChange);
    return () => {
      media.removeEventListener('change', onChange);
      clearTransitionTimers();
    };
  }, [preference]);

  const resolvedTheme: ResolvedTheme = preference === 'auto'
    ? (systemDark ? 'dark' : 'light')
    : preference;

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.themePreference = preference;
    root.dataset.theme = resolvedTheme;
    root.style.colorScheme = resolvedTheme;

    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta) meta.content = resolvedTheme === 'dark' ? '#081226' : '#f1eadf';
  }, [preference, resolvedTheme]);

  const setPreference = (next: ThemePreference) => {
    const nextResolved: ResolvedTheme = next === 'auto'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : next;

    window.localStorage.setItem(STORAGE_KEY, next);

    if (nextResolved === resolvedTheme) {
      setPreferenceState(next);
      return;
    }

    runDimmerTransition(() => setPreferenceState(next));
  };

  const value = useMemo<ThemeValue>(() => ({
    preference,
    resolvedTheme,
    setPreference,
  }), [preference, resolvedTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
}
