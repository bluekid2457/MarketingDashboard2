import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { MarkdownPostPreview } from '@/components/MarkdownPostPreview';

/**
 * Component tests for the Bucket-B long-form preview. The renderer is
 * ``react-markdown`` with ``remark-gfm`` — these tests cover heading
 * rendering, GFM strike/bold/italic, link safety attributes, raw-HTML
 * sanitization (no ``rehype-raw``), and the caveat strip.
 */
describe('MarkdownPostPreview', () => {
  it('renders an ATX heading as <h1> and the body as <p>', () => {
    render(<MarkdownPostPreview markdown={'# Heading\n\nbody'} showCaveat={false} />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toBe('Heading');
    const paragraph = screen.getByText('body');
    expect(paragraph.tagName.toLowerCase()).toBe('p');
  });

  it('renders bold, italic, and strikethrough markers as <strong>/<em>/<del>', () => {
    const { container } = render(
      <MarkdownPostPreview markdown="**bold** *italic* ~~strike~~" showCaveat={false} />,
    );
    expect(container.querySelectorAll('strong').length).toBe(1);
    expect(container.querySelectorAll('em').length).toBe(1);
    expect(container.querySelectorAll('del').length).toBe(1);
  });

  it('opens links in a new tab with the noopener noreferrer rel', () => {
    render(
      <MarkdownPostPreview
        markdown="[link](https://example.com)"
        showCaveat={false}
      />,
    );
    const link = screen.getByRole('link', { name: 'link' });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('treats raw HTML <script> as literal text, not as a DOM element', () => {
    const { container } = render(
      <MarkdownPostPreview
        markdown={'<script>alert(1)</script>'}
        showCaveat={false}
      />,
    );
    // No actual <script> child should be inserted into the DOM.
    expect(container.querySelector('script')).toBeNull();
    // The text content should include the literal markup.
    expect(container.textContent).toContain('alert(1)');
  });

  it('renders the caveat copy mentioning "rendered markdown" by default', () => {
    render(<MarkdownPostPreview markdown="hi" />);
    const caveat = screen.getByText(/rendered markdown/i);
    expect(caveat).toBeInTheDocument();
  });
});
