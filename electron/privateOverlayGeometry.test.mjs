import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  getBoundsFromDisplayRelativeBounds,
  getPreferredOverlaySizeForEdge
} = require('./privateOverlayGeometry.cjs');

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

  it('restores bounds from display-relative percentages on a different work area', () => {
    expect(getBoundsFromDisplayRelativeBounds(
      {
        height: 0.5,
        width: 0.5,
        x: 0.25,
        y: 0.25
      },
      {
        id: 2,
        workArea: {
          height: 900,
          width: 1600,
          x: 1920,
          y: 32
        }
      }
    )).toEqual({
      height: 450,
      width: 800,
      x: 2320,
      y: 257
    });
  });

  it('keeps centre-relative positions centred when a work area changes size', () => {
    expect(getBoundsFromDisplayRelativeBounds(
      {
        height: 0.444444,
        width: 0.5,
        x: 0.25,
        y: 0.277778
      },
      {
        height: 1800,
        width: 3200,
        x: 0,
        y: 0
      }
    )).toEqual({
      height: 800,
      width: 1600,
      x: 800,
      y: 500
    });
  });
});
