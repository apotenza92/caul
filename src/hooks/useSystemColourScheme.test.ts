import { render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applySystemColourScheme, getSystemColourScheme, useSystemColourScheme } from './useSystemColourScheme';

type SchemeListener = () => void;

let listeners: SchemeListener[] = [];

afterEach(() => {
  listeners = [];
  vi.restoreAllMocks();
});

describe('system colour scheme', () => {
  it('applies light and dark classes to the document root', () => {
    applySystemColourScheme('dark');

    expect(document.documentElement).toHaveClass('dark');
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');

    applySystemColourScheme('light');

    expect(document.documentElement).not.toHaveClass('dark');
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  it('reads the current OS preference', () => {
    mockMatchMedia(true);

    expect(getSystemColourScheme()).toBe('dark');
  });

  it('updates when the OS preference changes', async () => {
    const scheme = mockMatchMedia(false);

    render(createElement(SystemColourSchemeProbe));

    await waitFor(() => expect(document.documentElement).toHaveAttribute('data-theme', 'light'));

    scheme.matches = true;
    listeners.forEach((listener) => listener());

    await waitFor(() => expect(document.documentElement).toHaveClass('dark'));
  });
});

function SystemColourSchemeProbe() {
  useSystemColourScheme();
  return null;
}

function mockMatchMedia(initialMatches: boolean) {
  const scheme = {
    matches: initialMatches
  };

  vi.stubGlobal('matchMedia', vi.fn(() => ({
    get matches() {
      return scheme.matches;
    },
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: (_event: string, listener: SchemeListener) => listeners.push(listener),
    removeEventListener: (_event: string, listener: SchemeListener) => {
      listeners = listeners.filter((currentListener) => currentListener !== listener);
    },
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn()
  })));

  return scheme;
}
