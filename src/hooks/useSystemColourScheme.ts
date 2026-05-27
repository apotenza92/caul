import { useEffect } from 'react';

export type SystemColourScheme = 'dark' | 'light';

const darkSchemeQuery = '(prefers-color-scheme: dark)';

export function getSystemColourScheme(): SystemColourScheme {
  if (!window.matchMedia) {
    return 'light';
  }

  return window.matchMedia(darkSchemeQuery).matches ? 'dark' : 'light';
}

export function applySystemColourScheme(scheme = getSystemColourScheme(), root = document.documentElement) {
  root.classList.toggle('dark', scheme === 'dark');
  root.dataset.theme = scheme;
  root.style.colorScheme = scheme;
}

export function useSystemColourScheme() {
  useEffect(() => {
    if (!window.matchMedia) {
      applySystemColourScheme('light');
      return;
    }

    const mediaQuery = window.matchMedia(darkSchemeQuery);
    const syncScheme = () => applySystemColourScheme(mediaQuery.matches ? 'dark' : 'light');

    syncScheme();
    mediaQuery.addEventListener('change', syncScheme);

    return () => {
      mediaQuery.removeEventListener('change', syncScheme);
    };
  }, []);
}
