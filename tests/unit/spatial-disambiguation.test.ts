import { describe, it, expect } from 'vitest';
import { LocatorDisambiguationEngine } from '../../src/intelligence/locator-disambiguation-engine.js';
import { ResolvedElement } from '../../src/trace/snapshot-resolver.js';

describe('Spatial & Layout Drift Disambiguation', () => {
  it('disambiguates identical text candidates using bounding box spatial coordinates', () => {
    const candidate1: ResolvedElement = {
      tag: 'button',
      role: 'button',
      accessibleName: 'Delete Item',
      attributes: { role: 'button' },
      text: 'Delete Item',
      children: [],
      boundingBox: { x: 100, y: 200, width: 80, height: 32 },
    };

    const candidate2: ResolvedElement = {
      tag: 'button',
      role: 'button',
      accessibleName: 'Delete Item',
      attributes: { role: 'button' },
      text: 'Delete Item',
      children: [],
      boundingBox: { x: 100, y: 550, width: 80, height: 32 },
    };

    const result = LocatorDisambiguationEngine.disambiguate(
      [candidate1, candidate2],
      {
        targetBoundingBox: { x: 102, y: 204, width: 80, height: 32 },
      },
      'page'
    );

    expect(result.strategy).toBe('SPATIAL_COORDINATE_MATCH');
    expect(result.isUnique).toBe(true);
    expect(result.resolvedCandidate).toBe(candidate1);
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('safely abstains when neither candidate matches the target coordinates', () => {
    const candidate1: ResolvedElement = {
      tag: 'button',
      role: 'button',
      accessibleName: 'Submit',
      attributes: { role: 'button' },
      text: 'Submit',
      children: [],
      boundingBox: { x: 10, y: 20, width: 50, height: 20 },
    };

    const candidate2: ResolvedElement = {
      tag: 'button',
      role: 'button',
      accessibleName: 'Submit',
      attributes: { role: 'button' },
      text: 'Submit',
      children: [],
      boundingBox: { x: 12, y: 22, width: 50, height: 20 },
    };

    // Both are equally close/indistinguishable (distance delta < 20px)
    const result = LocatorDisambiguationEngine.disambiguate(
      [candidate1, candidate2],
      {
        targetBoundingBox: { x: 500, y: 800, width: 50, height: 20 },
      },
      'page'
    );

    expect(result.strategy).toBe('ABSTAIN_AMBIGUOUS');
    expect(result.isUnique).toBe(false);
  });
});
