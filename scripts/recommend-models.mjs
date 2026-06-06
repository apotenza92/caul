import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  buildSystemProfile,
  getCurrentMemoryFit,
  getHardwareFit,
  getRecommendationMemoryGb,
  loadModelCatalogue,
  recommendFromCatalogue
} = require('../electron/modelRecommendation.cjs');

const catalogue = loadModelCatalogue();
const profile = buildSystemProfile();
const recommendation = recommendFromCatalogue(catalogue, profile);

function printLine(label, value) {
  console.log(`${label}: ${value}`);
}

function formatModel(model) {
  if (!model) {
    return 'none';
  }

  const size = model.modelSizeB ? `, ${model.modelSizeB}B` : '';
  const download = model.downloadSizeGb ? `, ${model.downloadSizeGb} GB download` : '';

  return `${model.name} (${model.id}${size}${download})`;
}

console.log('Caul model recommendation');
printLine('Catalogue reviewed', catalogue.lastReviewed);
printLine('Machine', `${profile.platform}/${profile.arch}, ${profile.cpuCores} CPU cores, ${profile.totalMemoryGb} GB RAM`);
printLine('Stable model capacity', `${getRecommendationMemoryGb(profile)} GB, based on total RAM with a conservative OS/app reserve`);
printLine('Current available memory', `${profile.currentAvailableMemoryGb ?? profile.freeMemoryGb} GB, shown for start-time headroom only`);
printLine('Accelerator', `${profile.accelerator}${profile.gpu?.name ? `, ${profile.gpu.name}` : ''}${profile.gpu?.vramGb ? `, ${profile.gpu.vramGb} GB ${profile.gpu.unifiedMemory ? 'unified memory' : 'VRAM'}` : ''}`);
console.log('');

console.log('Transcription');
printLine('Recommended', recommendation.transcription.recommendation);
printLine('Model', formatModel(recommendation.transcription.model));
printLine('Source', recommendation.transcription.source);
printLine('Reason', recommendation.transcription.reason);
console.log('');

console.log('AI responses');
printLine('Recommended', recommendation.ai.recommendation);
printLine('Model', formatModel(recommendation.ai.model));
printLine('Source', recommendation.ai.source);
printLine('Reason', recommendation.ai.reason);
console.log('');

console.log('Local AI candidate details');
for (const model of catalogue.aiResponse.filter((entry) => entry.local)) {
  const fit = getHardwareFit(model, profile);
  const currentFit = getCurrentMemoryFit(model, profile);
  const platformOk = !Array.isArray(model.platforms) || model.platforms.includes(profile.platform);
  const smokeOk = model.caulSmokeStatus !== 'failed-basic-instruction';
  const implemented = Boolean(model.implemented);
  const status = implemented && platformOk && smokeOk && fit.ok ? 'viable' : 'not recommended';
  const blockers = [
    implemented ? null : 'not implemented in Caul',
    platformOk ? null : `not available on ${profile.platform}`,
    smokeOk ? null : `Caul smoke status: ${model.caulSmokeStatus}`,
    ...fit.failures,
    currentFit.ok ? null : currentFit.failures[0]
  ].filter(Boolean);

  printLine(`- ${model.name}`, blockers.length > 0 ? `${status}, ${blockers.join('; ')}` : status);
}
