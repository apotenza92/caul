import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SafeMarkdown } from '@/components/safe-markdown';

describe('SafeMarkdown', () => {
  it('opens credential-free HTTPS links outside the renderer', () => {
    render(<SafeMarkdown>{'[Safe](https://example.com/path)'}</SafeMarkdown>);

    expect(screen.getByRole('link', { name: 'Safe' })).toMatchObject({
      href: 'https://example.com/path',
      rel: 'noreferrer noopener',
      target: '_blank'
    });
  });

  it('removes executable, local, insecure and credential-bearing destinations', () => {
    render(
      <SafeMarkdown>
        {'[Script](javascript:alert(1)) [File](file:///tmp/payload) [HTTP](http://example.com) [Credential](https://user:secret@example.com)'}
      </SafeMarkdown>
    );

    for (const name of ['Script', 'File', 'HTTP', 'Credential']) {
      expect(screen.queryByRole('link', { name })).not.toBeInTheDocument();
    }
  });

  it('never loads Markdown images inside a privileged renderer', () => {
    render(<SafeMarkdown>{'![Tracking pixel](https://example.com/pixel.png)'}</SafeMarkdown>);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
