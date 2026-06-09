function getUsableSelectedLocalAiModelId({ selectedModelId, service }) {
  const model = typeof selectedModelId === 'string' ? service.getModelById(selectedModelId) : null;

  if (!model) {
    return null;
  }

  const recommendedModel = service.getRecommendedModel();
  if (!recommendedModel || recommendedModel.id === model.id) {
    return model.id;
  }

  const selectedStatus = service.status(model.id);
  const selectedModelInstalled = Boolean(selectedStatus.runtime?.installed && selectedStatus.model?.installed);

  return selectedModelInstalled ? model.id : null;
}

module.exports = {
  getUsableSelectedLocalAiModelId
};
