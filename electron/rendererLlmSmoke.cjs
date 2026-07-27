function rendererLlmSmokeSucceeded(result, expectedResponse = '') {
  const finalValue = typeof result?.finalValue === 'string'
    ? result.finalValue.trim()
    : '';
  const expected = typeof expectedResponse === 'string'
    ? expectedResponse.trim()
    : '';

  return Boolean(
    result?.responseChanged
    && finalValue
    && finalValue !== 'No response yet.'
    && (!expected || finalValue === expected)
  );
}

module.exports = {
  rendererLlmSmokeSucceeded
};
