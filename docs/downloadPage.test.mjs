import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const html = readFileSync(resolve(root, 'docs/index.html'), 'utf8');
const readme = readFileSync(resolve(root, 'README.md'), 'utf8');
const productDescription = 'Caul recommends the best setup for your computer, including local models for transcription and AI when they fit, with cloud AI available when that makes more sense.';

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

function primaryDownload(dom) {
  return {
    href: dom.window.document.getElementById('download-btn').href,
    label: dom.window.document.getElementById('download-label').textContent
  };
}

describe('download page hero autodetect', () => {
  it('keeps the download page subtitle and README intro in sync', async () => {
    const dom = await loadDownloadPage();

    expect(dom.window.document.querySelector('.subtitle').textContent).toBe(productDescription);
    expect(readme).toContain(productDescription);
  });

  it('recommends Windows x64 downloads', async () => {
    const dom = await loadDownloadPage({ architecture: 'x86', platform: 'Windows' });

    expect(hero(dom).label).toContain('Download Caul for Windows x64');
    expect(hero(dom).href).toContain('Caul-windows-x64-setup.exe');
    expect([...dom.window.document.querySelectorAll('.arch-btn')].map((button) => button.id)).toEqual([
      'arch-x64',
      'arch-arm64'
    ]);
  });

  it('recommends Windows ARM64 downloads', async () => {
    const dom = await loadDownloadPage({ architecture: 'arm64', platform: 'Windows' });

    expect(hero(dom).label).toContain('Download Caul for Windows 11 ARM64');
    expect(hero(dom).href).toContain('Caul-windows-arm64-setup.exe');
  });

  it('recommends Linux x64 AppImage downloads', async () => {
    const dom = await loadDownloadPage({ architecture: 'x86', platform: 'Linux' });

    expect(hero(dom).label).toContain('Download Caul AppImage for Linux x64');
    expect(hero(dom).href).toContain('caul-x64.AppImage');
  });

  it('recommends Linux ARM64 AppImage downloads', async () => {
    const dom = await loadDownloadPage({ architecture: 'arm64', platform: 'Linux' });

    expect(hero(dom).label).toContain('Download Caul AppImage for Linux ARM64');
    expect(hero(dom).href).toContain('caul-arm64.AppImage');
  });

  it('recommends Apple Silicon Mac downloads for macOS', async () => {
    const dom = await loadDownloadPage({ architecture: 'arm64', platform: 'macOS' });

    expect(hero(dom).label).toContain('Download Caul for Apple Silicon Mac');
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

    expect(hero(dom).label).toContain('Download Caul .deb for Ubuntu x64');
    expect(hero(dom).href).toContain('caul-x64.deb');
    expect(hero(dom).link.getAttribute('aria-disabled')).toBeNull();
  });

  it('updates page title and mac download labels when beta is selected', async () => {
    const dom = await loadDownloadPage({ architecture: 'arm64', platform: 'macOS' });
    const document = dom.window.document;

    document.getElementById('download-options').open = true;
    document.getElementById('channel-beta').click();

    expect(document.getElementById('page-title').textContent).toBe('Caul Beta');
    expect(dom.window.document.title).toBe('Download Caul Beta');
    expect(hero(dom).label).toContain('Download Caul Beta for Apple Silicon Mac');
    expect(hero(dom).href).toContain('Caul-Beta-macos-arm64.zip');
    expect(primaryDownload(dom).label).toContain('Download Caul Beta for Apple Silicon Mac');
    expect(primaryDownload(dom).href).toContain('Caul-Beta-macos-arm64.zip');
  });

  it('uses beta asset URLs and channel-aware labels for selected platforms', async () => {
    const dom = await loadDownloadPage();
    const document = dom.window.document;

    document.getElementById('download-options').open = true;
    document.getElementById('channel-beta').click();
    document.getElementById('platform-windows').click();

    expect(hero(dom).label).toContain('Download Caul Beta for Windows x64');
    expect(hero(dom).href).toContain('Caul-Beta-windows-x64-setup.exe');
    expect(primaryDownload(dom).label).toContain('Download Caul Beta for Windows x64');
    expect(primaryDownload(dom).href).toContain('Caul-Beta-windows-x64-setup.exe');

    document.getElementById('platform-linux').click();
    document.getElementById('format-deb').click();

    expect(hero(dom).label).toContain('Download Caul Beta .deb for Ubuntu x64');
    expect(hero(dom).href).toContain('caul-beta-x64.deb');
    expect(primaryDownload(dom).label).toContain('Download Caul Beta .deb for Ubuntu x64');
    expect(primaryDownload(dom).href).toContain('caul-beta-x64.deb');
  });

  it('shows and copies the Homebrew command with a local-file fallback', async () => {
    const dom = await loadDownloadPage({ architecture: 'arm64', platform: 'macOS' });
    const document = dom.window.document;
    let execCommandName = '';

    document.execCommand = (command) => {
      execCommandName = command;
      return true;
    };

    expect(dom.window.getComputedStyle(document.getElementById('homebrew-code')).display).not.toBe('none');

    document.getElementById('homebrew-box').click();

    await new Promise((resolveTick) => {
      dom.window.setTimeout(resolveTick, 0);
    });

    expect(document.getElementById('homebrew-code').textContent).toContain('brew tap apotenza92/tap');
    expect(execCommandName).toBe('copy');
    expect(document.getElementById('homebrew-copy').textContent).toContain('Copied');
  });
});
