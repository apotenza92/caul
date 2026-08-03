import type { ComponentProps } from 'react';
import ReactMarkdown from 'react-markdown';

function safeMarkdownUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.username === '' && parsed.password === '' ? parsed.toString() : '';
  } catch {
    return '';
  }
}

export function SafeMarkdown({ components, ...props }: ComponentProps<typeof ReactMarkdown>) {
  return (
    <ReactMarkdown
      {...props}
      components={{
        ...components,
        a: ({ children, href, node: _node, ...linkProps }) => href ? (
          <a {...linkProps} href={href} rel="noreferrer noopener" target="_blank">{children}</a>
        ) : <span>{children}</span>,
        img: () => null
      }}
      urlTransform={safeMarkdownUrl}
    />
  );
}
