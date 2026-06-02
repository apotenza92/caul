function orientOverlaySizeForEdge(size, edge) {
  const width = Number(size.width);
  const height = Number(size.height);

  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return size;
  }

  const shouldFlipSize = (edge === 'top' || edge === 'bottom') && height > width;

  return shouldFlipSize
    ? { height: width, width: height }
    : { height, width };
}

function getPreferredOverlaySizeForEdge(size, edge, { minimumNonCompactWidth = 0, orient = true } = {}) {
  const oriented = orient ? orientOverlaySizeForEdge(size, edge) : size;

  return {
    height: oriented.height,
    width: edge === 'top' || edge === 'bottom'
      ? Math.max(oriented.width, minimumNonCompactWidth)
      : oriented.width
  };
}

module.exports = {
  getPreferredOverlaySizeForEdge,
  orientOverlaySizeForEdge
};
