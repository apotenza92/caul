#!/usr/bin/env node

const {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign
} = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { canonicalize } = require('@tufjs/canonical-json');

const roleNames = Object.freeze(['root', 'targets', 'snapshot', 'timestamp']);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function publicKeyDescription(publicKey) {
  const publicDer = publicKey.export({ format: 'der', type: 'spki' });
  return {
    keytype: 'ed25519',
    scheme: 'ed25519',
    keyval: { public: publicDer.subarray(-32).toString('hex') }
  };
}

function generateRoleKey() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicDescription = publicKeyDescription(publicKey);
  return {
    keyID: sha256(Buffer.from(canonicalize(publicDescription))),
    privateKey: privateKey.export({ format: 'pem', type: 'pkcs8' }),
    publicDescription
  };
}

function signMetadata(signed, keyID, privateKey) {
  return {
    signatures: [{
      keyid: keyID,
      sig: sign(null, Buffer.from(canonicalize(signed)), privateKey).toString('hex')
    }],
    signed
  };
}

function buildRoot({ keys, rootExpires }) {
  const rootSigned = {
    _type: 'root',
    spec_version: '1.0.31',
    version: 1,
    expires: rootExpires,
    consistent_snapshot: false,
    keys: Object.fromEntries(roleNames.map((role) => [
      keys[role].keyID,
      keys[role].publicDescription
    ])),
    roles: Object.fromEntries(roleNames.map((role) => [
      role,
      { keyids: [keys[role].keyID], threshold: 1 }
    ]))
  };
  return signMetadata(rootSigned, keys.root.keyID, keys.root.privateKey);
}

function createProductionTrust({
  privateKeyBundlePath,
  rootExpires = '2036-01-01T00:00:00Z',
  rootPath
}) {
  if (fs.existsSync(privateKeyBundlePath) || fs.existsSync(rootPath)) {
    throw new Error('Production TUF trust outputs must not already exist.');
  }
  if (!Number.isFinite(Date.parse(rootExpires)) || Date.parse(rootExpires) <= Date.now()) {
    throw new Error('The production TUF root expiry must be a future ISO-8601 timestamp.');
  }

  const keys = Object.fromEntries(roleNames.map((role) => [role, generateRoleKey()]));
  const root = buildRoot({ keys, rootExpires });
  const rootBytes = Buffer.from(`${JSON.stringify(root)}\n`);
  const privateBundle = {
    purpose: 'Caul production TUF signing keys',
    root_expires: rootExpires,
    root_sha256: sha256(rootBytes),
    root_version: 1,
    roles: Object.fromEntries(roleNames.map((role) => [
      role,
      {
        keyid: keys[role].keyID,
        private_key_pem: keys[role].privateKey
      }
    ]))
  };

  fs.mkdirSync(path.dirname(rootPath), { recursive: true });
  fs.mkdirSync(path.dirname(privateKeyBundlePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(rootPath, rootBytes, { flag: 'wx', mode: 0o644 });
  fs.writeFileSync(
    privateKeyBundlePath,
    `${JSON.stringify(privateBundle, null, 2)}\n`,
    { flag: 'wx', mode: 0o600 }
  );
  return {
    keyIDs: Object.fromEntries(roleNames.map((role) => [role, keys[role].keyID])),
    root,
    rootSha256: privateBundle.root_sha256
  };
}

function recoverProductionRoot({
  privateKeyBundlePath,
  rootExpires,
  rootPath
}) {
  if (fs.existsSync(rootPath)) {
    throw new Error('Recovered production TUF root output must not already exist.');
  }
  const privateBundle = JSON.parse(fs.readFileSync(privateKeyBundlePath, 'utf8'));
  const resolvedExpiry = rootExpires || privateBundle.root_expires;
  if (!Number.isFinite(Date.parse(resolvedExpiry))) {
    throw new Error('The recovery bundle has no valid TUF root expiry.');
  }
  const keys = Object.fromEntries(roleNames.map((role) => {
    const bundled = privateBundle.roles?.[role];
    const privateKey = createPrivateKey(bundled?.private_key_pem);
    const publicDescription = publicKeyDescription(createPublicKey(privateKey));
    const derivedKeyID = sha256(Buffer.from(canonicalize(publicDescription)));
    if (bundled?.keyid !== derivedKeyID) {
      throw new Error(`The recovery bundle has a mismatched ${role} key ID.`);
    }
    return [role, {
      keyID: derivedKeyID,
      privateKey,
      publicDescription
    }];
  }));
  const root = buildRoot({ keys, rootExpires: resolvedExpiry });
  const rootBytes = Buffer.from(`${JSON.stringify(root)}\n`);
  if (privateBundle.root_sha256 !== sha256(rootBytes)) {
    throw new Error('Recovered TUF root does not match the sealed root SHA-256.');
  }
  fs.mkdirSync(path.dirname(rootPath), { recursive: true });
  fs.writeFileSync(rootPath, rootBytes, { flag: 'wx', mode: 0o644 });
  return {
    root,
    rootSha256: privateBundle.root_sha256
  };
}

function option(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : null;
}

function main(argv = process.argv.slice(2)) {
  const privateKeyBundlePath = option(argv, '--private-key-bundle');
  const recoveryBundlePath = option(argv, '--recover-private-key-bundle');
  const rootExpires = option(argv, '--root-expires');
  const rootPath = option(argv, '--root');
  if (!rootPath || (!privateKeyBundlePath && !recoveryBundlePath)) {
    throw new Error(
      'Usage: create-tuf-production-trust.cjs '
      + '--root <new-public-file> '
      + '(--private-key-bundle <new-private-file> '
      + '| --recover-private-key-bundle <existing-private-file>)'
    );
  }
  if (privateKeyBundlePath && recoveryBundlePath) {
    throw new Error('Choose production trust creation or recovery, not both.');
  }
  const result = recoveryBundlePath
    ? recoverProductionRoot({
      privateKeyBundlePath: path.resolve(recoveryBundlePath),
      rootExpires,
      rootPath: path.resolve(rootPath)
    })
    : createProductionTrust({
      privateKeyBundlePath: path.resolve(privateKeyBundlePath),
      ...(rootExpires ? { rootExpires } : {}),
      rootPath: path.resolve(rootPath)
    });
  process.stdout.write(`Created Caul TUF root ${result.rootSha256}.\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  createProductionTrust,
  publicKeyDescription,
  recoverProductionRoot,
  roleNames
};
