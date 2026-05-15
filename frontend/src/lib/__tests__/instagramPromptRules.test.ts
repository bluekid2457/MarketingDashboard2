import { describe, expect, it } from 'vitest';

import { instagramPromptRules } from '@/lib/prompts/platforms/instagram';
import { getPromptRulesForPlatform } from '@/lib/prompts/platforms';

/**
 * Smoke tests for the Instagram prompt rules. The full content lives in
 * ``instagram.ts`` — this test asserts the salient facts that downstream
 * publishers and the orchestrator rely on (in particular the 2,200-char
 * caption limit and the registry wiring).
 */
describe('instagramPromptRules', () => {
  it('mentions the 2,200-character caption ceiling', () => {
    expect(instagramPromptRules).toContain('2,200');
  });

  it('is registered in the prompt platform registry', () => {
    expect(getPromptRulesForPlatform('instagram')).toBe(instagramPromptRules);
  });
});
