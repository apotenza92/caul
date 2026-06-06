import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const html = readFileSync(resolve(root, 'docs/index.html'), 'utf8');

async function loadDownloadPage({
  architecture = '',
  platform = '',
  userAgent = ''
} = {}) {
  const dom = new JSDOM(html, {
    beforeParse(window) {
      Object.defineProperty(window.navigator, 'platform', {
        configurable: true,
        value: platform
      });
      Object.defineProperty(window.navigator, 'userAgent', {
        configurable: true,
        value: userAgent
      });
      Object.defineProperty(window.navigator, 'userAgentData', {
        configurable: true,
        value: platform || architecture
          ? {
              architecture,
              platform
            }
          : undefined
      });
      window.matchMedia = () => ({
        addEventListener: () => {},
        matches: false,
        removeEventListener: () => {}
      });
    },
    runScripts: 'dangerously',
    url: 'https://apotenza92.github.io/caul/'
  });

  await new Promise((resolveTick) => {
    dom.window.setTimeout(resolveTick, 0);
  });

  return dom;
}

function hero(dom) {
  return {
    href: dom.window.document.getElementById('hero-download-btn').href,
    label: dom.window.document.getElementById('hero-download-label').textContent,
    link: dom.window.document.getElementById('hero-download-btn')
  };
}

describe('download page hero autodetect', () => {
  it('recommends Windows x64 downloads', async () => {
    const dom = await loadDownloadPage({ architecture: 'x86', platform: 'Windows' });

    expect(hero(dom).label).toContain('Download for Windows x64');
    expect(hero(dom).href).toContain('Caul-windows-x64-setup.exe');
    expect([...dom.window.document.querySelectorAll('.arch-btn')].map((button) => button.id)).toEqual([
      'arch-x64',
      'arch-arm64'
    ]);
  });

  it('recommends Windows ARM64 downloads', async () => {
    const dom = await loadDownloadPage({ architecture: 'arm64', platform: 'Windows' });

    expect(hero(dom).label).toContain('Download for Windows 11 ARM64');
    expect(hero(dom).href).toContain('Caul-windows-arm64-setup.exe');
  });

  it('recommends Linux x64 AppImage downloads', async () => {
    const dom = await loadDownloadPage({ architecture: 'x86', platform: 'Linux' });

    expect(hero(dom).label).toContain('Download AppImage for Linux x64');
    expect(hero(dom).href).toContain('caul-x64.AppImage');
  });

  it('recommends Linux ARM64 AppImage downloads', async () => {
    const dom = await loadDownloadPage({ architecture: 'arm64', platform: 'Linux' });

    expect(hero(dom).label).toContain('Download AppImage for Linux ARM64');
    expect(hero(dom).href).toContain('caul-arm64.AppImage');
  });

  it('recommends Apple Silicon Mac downloads for macOS', async () => {
    const dom = await loadDownloadPage({ architecture: 'arm64', platform: 'macOS' });

    expect(hero(dom).label).toContain('Download for Apple Silicon Mac');
    expect(hero(dom).href).toContain('Caul-macos-arm64.zip');
  });

  it('asks unknown platforms to choose a download', async () => {
    const dom = await loadDownloadPage();

    expect(hero(dom).label).toBe('Choose your download');
    expect(hero(dom).link.getAttribute('aria-disabled')).toBe('true');
  });

  it('updates the hero button when the user chooses another download', async () => {
    const dom = await loadDownloadPage();
    const document = dom.window.document;

    document.getElementById('download-options').open = true;
    document.getElementById('platform-linux').click();
    document.getElementById('format-deb').click();

    expect(hero(dom).label).toContain('Download .deb for Ubuntu x64');
    expect(hero(dom).href).toContain('caul-x64.deb');
    expect(hero(dom).link.getAttribute('aria-disabled')).toBeNull();
  });
});
