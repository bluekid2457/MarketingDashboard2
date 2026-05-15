import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import {
  UnicodePostPreview,
  UnicodePostPreviewCaveat,
} from '@/components/UnicodePostPreview';

/**
 * Component tests for the Bucket-A plain-text Unicode preview. The renderer
 * itself is the shared platform-neutral converter — these tests focus on
 * the wrapper contract: caveat copy, testids, ``showCaveat`` toggle, and
 * the data-platform attribute that selects per-platform copy.
 */
describe('UnicodePostPreview', () => {
  it('renders LinkedIn caveat copy referencing LinkedIn by name', () => {
    render(<UnicodePostPreview platform="linkedin" markdown="Hello" />);
    const caveat = screen.getByText(/Unicode formatting is not searchable/i);
    expect(caveat.textContent).toContain('LinkedIn');
  });

  it('renders Twitter caveat copy referencing "X / Twitter"', () => {
    render(<UnicodePostPreview platform="twitter" markdown="Hello" />);
    const caveat = screen.getByText(/Unicode formatting is not searchable/i);
    expect(caveat.textContent).toContain('X / Twitter');
  });

  it('renders Instagram caveat copy referencing Instagram by name', () => {
    render(<UnicodePostPreview platform="instagram" markdown="Hello" />);
    const caveat = screen.getByText(/Unicode formatting is not searchable/i);
    expect(caveat.textContent).toContain('Instagram');
  });

  it('converts **bold** to Math Sans Bold Unicode glyphs', () => {
    // "Hello" in Math Sans Bold — see linkedinFormat golden case #3.
    const expectedBold = '\u{1d5db}\u{1d5f2}\u{1d5f9}\u{1d5f9}\u{1d5fc}';
    render(<UnicodePostPreview platform="linkedin" markdown="**Hello**" />);
    const preview = screen.getByTestId('linkedin-preview');
    expect(preview.textContent).toContain(expectedBold);
  });

  it('suppresses the caveat strip when showCaveat={false}', () => {
    render(<UnicodePostPreview platform="linkedin" markdown="Hello" showCaveat={false} />);
    expect(screen.queryByText(/Unicode formatting is not searchable/i)).toBeNull();
  });

  it('uses the linkedin-preview testid when platform is linkedin (back-compat)', () => {
    render(<UnicodePostPreview platform="linkedin" markdown="Hello" />);
    expect(screen.getByTestId('linkedin-preview')).toBeInTheDocument();
  });

  it('uses unicode-preview-{platform} testid for twitter and instagram', () => {
    const { unmount } = render(
      <UnicodePostPreview platform="twitter" markdown="Hello" />,
    );
    expect(screen.getByTestId('unicode-preview-twitter')).toBeInTheDocument();
    unmount();

    render(<UnicodePostPreview platform="instagram" markdown="Hello" />);
    expect(screen.getByTestId('unicode-preview-instagram')).toBeInTheDocument();
  });

  it('exposes UnicodePostPreviewCaveat for standalone rendering', () => {
    render(<UnicodePostPreviewCaveat platform="instagram" />);
    expect(screen.getByText(/Instagram/)).toBeInTheDocument();
  });
});
