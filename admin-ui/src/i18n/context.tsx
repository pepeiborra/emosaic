import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { en } from './translations/en';
import { es } from './translations/es';
import type { Translations } from './translations/en';

export type Language = 'en' | 'es';

interface I18nContextType {
  language: Language;
  t: Translations;
}

const I18nContext = createContext<I18nContextType | null>(null);

const translations: Record<Language, Translations> = {
  en,
  es,
};

/**
 * Detect the user's preferred language from browser settings
 * Returns 'es' for Spanish variants, 'en' for everything else
 */
function detectLanguage(): Language {
  // Check navigator.language first (primary language)
  const primary = navigator.language?.toLowerCase() || '';
  if (primary.startsWith('es')) {
    return 'es';
  }

  // Check navigator.languages array for fallback preferences
  const languages = navigator.languages || [];
  for (const lang of languages) {
    if (lang.toLowerCase().startsWith('es')) {
      return 'es';
    }
  }

  // Default to English
  return 'en';
}

interface I18nProviderProps {
  children: ReactNode;
}

export function I18nProvider({ children }: I18nProviderProps) {
  const language = useMemo(() => detectLanguage(), []);
  const t = translations[language];

  const value = useMemo(
    () => ({
      language,
      t,
    }),
    [language, t]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextType {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return context;
}

/**
 * Convenience hook that returns just the translations object
 */
export function useTranslation(): Translations {
  return useI18n().t;
}
