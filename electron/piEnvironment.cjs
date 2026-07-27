const path = require('node:path');

const blockedEnvironmentNames = new Set([
  'NODE_OPTIONS',
  'NODE_PATH',
  'SSH_AUTH_SOCK'
]);

const credentialNamePattern = /(?:^|_)(?:API_?KEY|TOKEN|SECRET|PASSWORD|PASSPHRASE|CREDENTIALS?|ACCESS_?KEY|PRIVATE_?KEY|CLIENT_?SECRET)(?:_|$)/iu;

function isCredentialEnvironmentName(name) {
  return blockedEnvironmentNames.has(name) || credentialNamePattern.test(name);
}

function createPiEnvironment({
  agentDir,
  baseEnvironment = process.env,
  providerEnvironment = {}
}) {
  const environment = Object.fromEntries(
    Object.entries(baseEnvironment)
      .filter(([name, value]) => value !== undefined && !isCredentialEnvironmentName(name))
  );

  return {
    ...environment,
    PI_CODING_AGENT_DIR: agentDir,
    PI_CODING_AGENT_SESSION_DIR: path.join(agentDir, 'sessions'),
    ELECTRON_RUN_AS_NODE: '1',
    PI_SKIP_VERSION_CHECK: '1',
    PI_TELEMETRY: '0',
    ...providerEnvironment
  };
}

module.exports = {
  createPiEnvironment,
  isCredentialEnvironmentName
};
