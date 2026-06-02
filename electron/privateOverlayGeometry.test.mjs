import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { getPreferredOverlaySizeForEdge } = require('./privateOverlayGeometry.cjs');

describe('private overlay geometry', () => {
  it('restores non-compact width when moving a side-sized overlay to a horizontal edge', () => {
    expect(getPreferredOverlaySizeForEdge(
      { height: 900, width: 600 },
      'top',
      { minimumNonCompactWidth: 960 }
    )).toEqual({
      height: 600,
      width: 960
    });

    expect(getPreferredOverlaySizeForEdge(
      { height: 900, width: 600 },
      'bottom',
      { minimumNonCompactWidth: 960 }
    )).toEqual({
      height: 600,
      width: 960
    });
  });

  it('preserves horizontal overlay size when moving to side edges', () => {
    expect(getPreferredOverlaySizeForEdge(
      { height: 600, width: 960 },
      'right',
      { minimumNonCompactWidth: 960 }
    )).toEqual({
      height: 600,
      width: 960
    });

    expect(getPreferredOverlaySizeForEdge(
      { height: 600, width: 960 },
      'left',
      { minimumNonCompactWidth: 960 }
    )).toEqual({
      height: 600,
      width: 960
    });
  });

  it('preserves compact manual sizes on horizontal edges when orientation is disabled', () => {
    expect(getPreferredOverlaySizeForEdge(
      { height: 900, width: 600 },
      'top',
      { minimumNonCompactWidth: 0, orient: false }
    )).toEqual({
      height: 900,
      width: 600
    });

    expect(getPreferredOverlaySizeForEdge(
      { height: 900, width: 600 },
      'bottom',
      { minimumNonCompactWidth: 0, orient: false }
    )).toEqual({
      height: 900,
      width: 600
    });
  });
});
