import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { translate, type Locale } from './translations';

const STORAGE_KEY = 'coda.locale';

interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (text: string) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

function detectInitialLocale(): Locale {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'de' || stored === 'en') return stored;
  return window.navigator.language.toLowerCase().startsWith('de') ? 'de' : 'en';
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectInitialLocale);

  const setLocale = (next: Locale) => {
    window.localStorage.setItem(STORAGE_KEY, next);
    setLocaleState(next);
  };

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<I18nValue>(() => ({
    locale,
    setLocale,
    t: (text) => translate(locale, text),
  }), [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside I18nProvider');
  return value;
}
