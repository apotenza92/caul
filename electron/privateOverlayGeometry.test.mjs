import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { getPreferredOverlaySizeForEdge } = require('./privateOverlayGeometry.cjs');

describe('private overlay geometry', () => {
  it('restores non-compact width when moving a side-sized overlay to a horizontal edge', () => {
    expect(getPreferredOverlaySizeForEdge(
      { height: 900, width: 600 },
      'top',
      { minimumNonCompactWidth: 920 }
    )).toEqual({
      height: 600,
      width: 920
    });

    expect(getPreferredOverlaySizeForEdge(
      { height: 900, width: 600 },
      'bottom',
      { minimumNonCompactWidth: 920 }
    )).toEqual({
      height: 600,
      width: 920
    });
  });

  it('keeps side edges compact when moving a horizontal overlay to a side edge', () => {
    expect(getPreferredOverlaySizeForEdge(
      { height: 600, width: 920 },
      'right',
      { minimumNonCompactWidth: 920 }
    )).toEqual({
      height: 920,
      width: 600
    });
  });
});
