import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createLocalLlmService } = require('./localLlm.cjs');
const catalogue = JSON.parse(readFileSync(resolve(import.meta.dirname, '..', 'model-catalog.json'), 'utf8'));

function createService() {
  const root = mkdtempSync(join(tmpdir(), 'caul-local-llm-test-'));
  const app = {
    getPath: () => root
  };
  const service = createLocalLlmService({ app, catalogue: createLlamaOnlyCatalogue() });

  return {
    root,
    service,
    cleanup: () => rmSync(root, { force: true, recursive: true })
  };
}

function createLlamaOnlyCatalogue() {
  const copy = structuredClone(catalogue);
  copy.aiResponse = copy.aiResponse.map((model) => model.runtime === 'mlx-lm'
    ? { ...model, implemented: false }
    : model);

  return copy;
}

function createMlxOnlyCatalogue() {
  const copy = structuredClone(catalogue);
  copy.aiResponse = copy.aiResponse.map((model) => ({
    ...model,
    implemented: model.runtime === 'mlx-lm',
    providerModelId: model.runtime === 'mlx-lm' ? 'test/mlx-model' : model.providerModelId
  }));

  return copy;
}

function createTestCatalogue({ runtimeUrl = 'https://example.invalid/runtime.tar.gz', modelUrl = 'https://example.invalid/model.gguf' } = {}) {
  const copy = createLlamaOnlyCatalogue();
  const runtimeAsset = copy.runtimes.llamaCpp.assets[`${process.platform}-${process.arch}`]
    ?? Object.values(copy.runtimes.llamaCpp.assets)[0];
  copy.runtimes.llamaCpp.assets = {
    [`${process.platform}-${process.arch}`]: {
      ...runtimeAsset,
      archiveName: 'llama-test.tar.gz',
      sizeBytes: 12,
      url: runtimeUrl
    }
  };
  copy.aiResponse = copy.aiResponse.map((model) => model.runtime === 'llama.cpp'
    ? {
      ...model,
      downloadSizeGb: 0.000001,
      downloadUrl: modelUrl,
      fileName: 'test-model.gguf'
    }
    : model);

  return copy;
}

function createTwoModelCatalogue({
  firstModelUrl = 'https://example.invalid/first.gguf',
  runtimeUrl = 'https://example.invalid/runtime.tar.gz',
  secondModelUrl = 'https://example.invalid/second.gguf'
} = {}) {
  const copy = createTestCatalogue({ modelUrl: firstModelUrl, runtimeUrl });
  const first = copy.aiResponse.find((model) => (
    model.runtime === 'llama.cpp'
    && model.local
    && model.implemented
    && model.caulSmokeStatus !== 'failed-basic-instruction'
    && (!Array.isArray(model.platforms) || model.platforms.includes(process.platform))
  ));

  copy.aiResponse = [{
    ...first,
    defaultPriority: 100,
    fileName: 'first-model.gguf',
    id: 'first-local-model',
    name: 'First Local Model'
  }, {
    ...first,
    defaultPriority: 10,
    downloadUrl: secondModelUrl,
    fileName: 'second-model.gguf',
    id: 'second-local-model',
    name: 'Second Local Model'
  }];

  return copy;
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : 0);
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

function createDownloadServer() {
  const server = http.createServer((request, response) => {
    if (request.url === '/runtime.tar.gz') {
      response.writeHead(200, {
        'Content-Length': '12',
        'Content-Type': 'application/octet-stream'
      });
      response.end('runtime data');
      return;
    }

    if (request.url === '/model.gguf') {
      response.writeHead(200, {
        'Content-Length': '10',
        'Content-Type': 'application/octet-stream'
      });
      response.end('model data');
      return;
    }

    if (request.url === '/first.gguf') {
      response.writeHead(200, {
        'Content-Length': '11',
        'Content-Type': 'application/octet-stream'
      });
      response.end('first model');
      return;
    }

    if (request.url === '/second.gguf') {
      response.writeHead(200, {
        'Content-Length': '12',
        'Content-Type': 'application/octet-stream'
      });
      response.end('second model');
      return;
    }

    response.writeHead(404);
    response.end();
  });

  return server;
}

function fakeExtractorSpawn(root) {
  return () => {
    const child = new EventEmitter();
    child.stderr = new EventEmitter();

    queueMicrotask(() => {
      const serverPath = join(root, 'local-llm', 'runtimes', 'llama.cpp', 'bin', process.platform === 'win32' ? 'llama-server.exe' : 'llama-server');
      mkdirSync(dirname(serverPath), { recursive: true });
      writeFileSync(serverPath, 'fake server');
      child.emit('exit', 0);
    });

    return child;
  };
}

function createFakeLlamaSpawn(options = {}) {
  const servers = new Set();

  const spawn = (_command, args) => {
    options.launches?.push({ args });
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    const port = Number(args[args.indexOf('--port') + 1]);
    const server = http.createServer((request, response) => {
      if (request.url === '/health') {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ status: 'ok' }));
        return;
      }

      if (request.url === '/v1/chat/completions' && request.method === 'POST') {
        options.requests?.push({ url: request.url });
        request.resume();
        response.writeHead(200, {
          'Content-Type': 'text/event-stream'
        });
        response.write('data: {"choices":[{"delta":{"content":"Local "}}]}\n\n');
        response.write('data: {"choices":[{"delta":{"content":"answer"}}]}\n\n');
        response.end('data: [DONE]\n\n');
        return;
      }

      response.writeHead(404);
      response.end();
    });

    server.listen(port, '127.0.0.1', () => undefined);
    servers.add(server);
    child.kill = () => {
      servers.delete(server);
      server.close(() => {
        child.emit('exit', 0);
      });
    };

    return child;
  };

  spawn.closeAll = async () => {
    await Promise.all([...servers].map(closeServer));
    servers.clear();
  };

  return spawn;
}

function fakeMlxSpawn(root, options = {}) {
  return (command, args) => {
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    let server = null;

    queueMicrotask(() => {
      if (command === 'uv') {
        if (args[0] === 'venv') {
          const pythonPath = join(root, 'local-llm', 'runtimes', 'mlx-lm', 'venv', process.platform === 'win32' ? 'Scripts' : 'bin', process.platform === 'win32' ? 'python.exe' : 'python');
          mkdirSync(dirname(pythonPath), { recursive: true });
          writeFileSync(pythonPath, 'fake python');
        }
        if (args[0] === 'pip') {
          const serverPath = join(root, 'local-llm', 'runtimes', 'mlx-lm', 'venv', process.platform === 'win32' ? 'Scripts' : 'bin', process.platform === 'win32' ? 'mlx_lm.server.exe' : 'mlx_lm.server');
          mkdirSync(dirname(serverPath), { recursive: true });
          writeFileSync(serverPath, 'fake mlx server');
        }
        child.emit('exit', 0);
        return;
      }

      if (String(command).endsWith('/hf') || String(command).endsWith('hf.exe')) {
        const modelPath = join(root, 'local-llm', 'runtimes', 'mlx-lm', 'cache', 'huggingface', 'hub', 'models--test--mlx-model', 'snapshots', 'abc123');
        mkdirSync(modelPath, { recursive: true });
        writeFileSync(join(modelPath, 'config.json'), '{}');
        writeFileSync(join(modelPath, 'model.safetensors'), 'fake weights');
        child.emit('exit', 0);
        return;
      }

      if (args.includes('--port')) {
        const port = Number(args[args.indexOf('--port') + 1]);
        server = http.createServer((request, response) => {
          if (request.url === '/health') {
            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ status: 'ok' }));
            return;
          }

          if (request.url === '/v1/chat/completions' && request.method === 'POST') {
            const chunks = [];
            request.on('data', (chunk) => chunks.push(chunk));
            request.on('end', () => {
              options.requests?.push(JSON.parse(Buffer.concat(chunks).toString()));
            });
            response.writeHead(200, { 'Content-Type': 'text/event-stream' });
            response.end('data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n');
            return;
          }

          response.writeHead(404);
          response.end();
        });
        server.listen(port, '127.0.0.1');
        return;
      }

      child.emit('exit', 0);
    });

    child.kill = () => {
      if (server) {
        server.close(() => child.emit('exit', 0));
      } else {
        child.emit('exit', 0);
      }
    };

    return child;
  };
}

function fakeMlxSpawnSync() {
  return (command) => {
    if (command === 'uv') {
      return { status: 0, stdout: 'uv 0.11.19' };
    }

    return { status: 0, stdout: 'installed' };
  };
}

describe('local LLM service', () => {
  it('reports the Caul-managed model and runtime status', () => {
    const test = createService();

    try {
      const status = test.service.status();

      expect(status.provider).toBe('caul-llama.cpp');
      expect(status.runtime.supported).toBe(['darwin-arm64', 'linux-arm64', 'linux-x64', 'win32-arm64', 'win32-x64'].includes(`${process.platform}-${process.arch}`));
      expect(status.model.id).toBe('qwen2.5-3b-instruct-q4_k_m');
    } finally {
      test.cleanup();
    }
  });

  it('reports status for a targeted local AI model id', () => {
    const root = mkdtempSync(join(tmpdir(), 'caul-local-llm-test-'));

    try {
      const service = createLocalLlmService({
        app: { getPath: () => root },
        catalogue: createTwoModelCatalogue()
      });
      const firstPath = service.getModelPath(service.getModelById('first-local-model'));
      const secondPath = service.getModelPath(service.getModelById('second-local-model'));
      const serverPath = join(root, 'local-llm', 'runtimes', 'llama.cpp', 'bin', process.platform === 'win32' ? 'llama-server.exe' : 'llama-server');
      mkdirSync(dirname(firstPath), { recursive: true });
      mkdirSync(dirname(serverPath), { recursive: true });
      writeFileSync(firstPath, 'fake first model');
      writeFileSync(serverPath, 'fake server');

      const defaultStatus = service.status();
      const targetedStatus = service.status('second-local-model');

      expect(defaultStatus.model.id).toBe('first-local-model');
      expect(defaultStatus.status).toBe('ready');
      expect(targetedStatus.model.id).toBe('second-local-model');
      expect(targetedStatus.model.path).toBe(secondPath);
      expect(targetedStatus.status).toBe('missing');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('detects an installed runtime and model in app data', () => {
    const test = createService();

    try {
      const model = test.service.getRecommendedModel();
      const modelPath = test.service.getModelPath(model);
      const serverPath = join(test.root, 'local-llm', 'runtimes', 'llama.cpp', 'bin', process.platform === 'win32' ? 'llama-server.exe' : 'llama-server');
      mkdirSync(dirname(modelPath), { recursive: true });
      mkdirSync(dirname(serverPath), { recursive: true });
      writeFileSync(modelPath, 'fake model');
      writeFileSync(serverPath, 'fake server');

      const status = test.service.status();

      expect(status.status).toBe('ready');
      expect(status.model.installed).toBe(true);
      expect(status.runtime.installed).toBe(true);
    } finally {
      test.cleanup();
    }
  });

  it('downloads a targeted local AI model without switching to the default recommendation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'caul-local-llm-test-'));
    const server = createDownloadServer();
    const progressModelIds = [];

    try {
      const port = await listen(server);
      const service = createLocalLlmService({
        app: { getPath: () => root },
        catalogue: createTwoModelCatalogue({
          firstModelUrl: `http://127.0.0.1:${port}/first.gguf`,
          runtimeUrl: `http://127.0.0.1:${port}/runtime.tar.gz`,
          secondModelUrl: `http://127.0.0.1:${port}/second.gguf`
        }),
        emitStatus: (status) => progressModelIds.push(status.model?.id),
        httpsModule: http,
        spawn: fakeExtractorSpawn(root)
      });

      const status = await service.download('second-local-model');

      expect(status.status).toBe('ready');
      expect(status.model.id).toBe('second-local-model');
      expect(status.model.path.endsWith('second-model.gguf')).toBe(true);
      expect(readFileSync(status.model.path, 'utf8')).toBe('second model');
      expect(service.status('first-local-model').model.installed).toBe(false);
      expect(progressModelIds).toContain('second-local-model');
      expect(progressModelIds).not.toContain('first-local-model');
    } finally {
      await closeServer(server);
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('downloads the Caul-managed runtime and model into app data', async () => {
    const root = mkdtempSync(join(tmpdir(), 'caul-local-llm-test-'));
    const server = createDownloadServer();

    try {
      const port = await listen(server);
      const service = createLocalLlmService({
        app: { getPath: () => root },
        catalogue: createTestCatalogue({
          modelUrl: `http://127.0.0.1:${port}/model.gguf`,
          runtimeUrl: `http://127.0.0.1:${port}/runtime.tar.gz`
        }),
        httpsModule: http,
        spawn: fakeExtractorSpawn(root)
      });

      const status = await service.download();

      expect(status.status).toBe('ready');
      expect(status.runtime.installed).toBe(true);
      expect(status.model.installed).toBe(true);
    } finally {
      await closeServer(server);
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('reports local AI download progress as one forward-moving sequence', async () => {
    const root = mkdtempSync(join(tmpdir(), 'caul-local-llm-test-'));
    const server = createDownloadServer();
    const progressEvents = [];

    try {
      const port = await listen(server);
      const service = createLocalLlmService({
        app: { getPath: () => root },
        catalogue: createTestCatalogue({
          modelUrl: `http://127.0.0.1:${port}/model.gguf`,
          runtimeUrl: `http://127.0.0.1:${port}/runtime.tar.gz`
        }),
        emitStatus: (status) => {
          if (status.progress) {
            progressEvents.push(status.progress);
          }
        },
        httpsModule: http,
        spawn: fakeExtractorSpawn(root)
      });

      await service.download();

      const percents = progressEvents.map((progress) => progress.percent);
      expect(percents.length).toBeGreaterThan(2);
      expect(percents).toEqual([...percents].sort((left, right) => left - right));
      expect(progressEvents.map((progress) => progress.label)).toEqual(expect.arrayContaining([
        'Downloading local AI runtime',
        'Installing local AI runtime',
        'Downloading local AI model'
      ]));
    } finally {
      await closeServer(server);
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('starts the loopback llama.cpp server and streams a chat response', async () => {
    const root = mkdtempSync(join(tmpdir(), 'caul-local-llm-test-'));
    const spawn = createFakeLlamaSpawn();

    try {
      const service = createLocalLlmService({
        app: { getPath: () => root },
        catalogue: createTestCatalogue(),
        spawn
      });
      const model = service.getRecommendedModel();
      const modelPath = service.getModelPath(model);
      const serverPath = join(root, 'local-llm', 'runtimes', 'llama.cpp', 'bin', process.platform === 'win32' ? 'llama-server.exe' : 'llama-server');
      mkdirSync(dirname(modelPath), { recursive: true });
      mkdirSync(dirname(serverPath), { recursive: true });
      writeFileSync(modelPath, 'fake model');
      writeFileSync(serverPath, 'fake server');

      const deltas = [];
      const response = await service.request('Summarise the call.', {
        onDelta: (delta) => deltas.push(delta)
      });

      expect(response).toBe('Local answer');
      expect(deltas).toEqual(['Local ', 'answer']);
      service.stop();
    } finally {
      await spawn.closeAll();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('warms the loopback llama.cpp server without sending a chat completion', async () => {
    const root = mkdtempSync(join(tmpdir(), 'caul-local-llm-test-'));
    const launches = [];
    const requests = [];
    const statusEvents = [];
    const spawn = createFakeLlamaSpawn({ launches, requests });

    try {
      const service = createLocalLlmService({
        app: { getPath: () => root },
        catalogue: createTestCatalogue(),
        emitStatus: (status) => statusEvents.push(status.status),
        spawn
      });
      const model = service.getRecommendedModel();
      const modelPath = service.getModelPath(model);
      const serverPath = join(root, 'local-llm', 'runtimes', 'llama.cpp', 'bin', process.platform === 'win32' ? 'llama-server.exe' : 'llama-server');
      mkdirSync(dirname(modelPath), { recursive: true });
      mkdirSync(dirname(serverPath), { recursive: true });
      writeFileSync(modelPath, 'fake model');
      writeFileSync(serverPath, 'fake server');

      const status = await service.warm();

      expect(status.status).toBe('warm');
      expect(service.status().status).toBe('warm');
      expect(launches).toHaveLength(1);
      expect(launches.at(-1).args).toContain(modelPath);
      expect(requests).toHaveLength(0);
      expect(statusEvents).toEqual(expect.arrayContaining(['warming', 'warm']));
      service.stop();
    } finally {
      await spawn.closeAll();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('does not relaunch an already warm llama.cpp model', async () => {
    const root = mkdtempSync(join(tmpdir(), 'caul-local-llm-test-'));
    const launches = [];
    const spawn = createFakeLlamaSpawn({ launches });

    try {
      const service = createLocalLlmService({
        app: { getPath: () => root },
        catalogue: createTestCatalogue(),
        spawn
      });
      const model = service.getRecommendedModel();
      const modelPath = service.getModelPath(model);
      const serverPath = join(root, 'local-llm', 'runtimes', 'llama.cpp', 'bin', process.platform === 'win32' ? 'llama-server.exe' : 'llama-server');
      mkdirSync(dirname(modelPath), { recursive: true });
      mkdirSync(dirname(serverPath), { recursive: true });
      writeFileSync(modelPath, 'fake model');
      writeFileSync(serverPath, 'fake server');

      await service.warm();
      const status = await service.warm();

      expect(status.status).toBe('warm');
      expect(launches).toHaveLength(1);
      service.stop();
    } finally {
      await spawn.closeAll();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('reports missing when asked to warm without local AI files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'caul-local-llm-test-'));
    const launches = [];
    const spawn = createFakeLlamaSpawn({ launches });

    try {
      const service = createLocalLlmService({
        app: { getPath: () => root },
        catalogue: createTestCatalogue(),
        spawn
      });

      const status = await service.warm();

      expect(status.status).toBe('missing');
      expect(status.runtime.installed).toBe(false);
      expect(status.model.installed).toBe(false);
      expect(launches).toHaveLength(0);
    } finally {
      await spawn.closeAll();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('starts the loopback llama.cpp server with a targeted local AI model', async () => {
    const root = mkdtempSync(join(tmpdir(), 'caul-local-llm-test-'));
    const launches = [];
    const spawn = createFakeLlamaSpawn({ launches });

    try {
      const service = createLocalLlmService({
        app: { getPath: () => root },
        catalogue: createTwoModelCatalogue(),
        spawn
      });
      const selectedModel = service.getModelById('second-local-model');
      const selectedModelPath = service.getModelPath(selectedModel);
      const defaultModelPath = service.getModelPath(service.getModelById('first-local-model'));
      const serverPath = join(root, 'local-llm', 'runtimes', 'llama.cpp', 'bin', process.platform === 'win32' ? 'llama-server.exe' : 'llama-server');
      mkdirSync(dirname(selectedModelPath), { recursive: true });
      mkdirSync(dirname(serverPath), { recursive: true });
      writeFileSync(selectedModelPath, 'fake selected model');
      writeFileSync(defaultModelPath, 'fake default model');
      writeFileSync(serverPath, 'fake server');

      const response = await service.request('Summarise the call.', {
        modelId: 'second-local-model',
        onDelta: () => undefined
      });

      expect(response).toBe('Local answer');
      expect(launches.at(-1).args).toContain(selectedModelPath);
      expect(launches.at(-1).args).not.toContain(defaultModelPath);
      service.stop();
    } finally {
      await spawn.closeAll();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('benchmarks a targeted local AI model through the loopback server', async () => {
    const root = mkdtempSync(join(tmpdir(), 'caul-local-llm-test-'));
    const launches = [];
    const spawn = createFakeLlamaSpawn({ launches });

    try {
      const service = createLocalLlmService({
        app: { getPath: () => root },
        catalogue: createTwoModelCatalogue(),
        spawn
      });
      const selectedModel = service.getModelById('second-local-model');
      const selectedModelPath = service.getModelPath(selectedModel);
      const defaultModelPath = service.getModelPath(service.getModelById('first-local-model'));
      const serverPath = join(root, 'local-llm', 'runtimes', 'llama.cpp', 'bin', process.platform === 'win32' ? 'llama-server.exe' : 'llama-server');
      mkdirSync(dirname(selectedModelPath), { recursive: true });
      mkdirSync(dirname(serverPath), { recursive: true });
      writeFileSync(selectedModelPath, 'fake selected model');
      writeFileSync(defaultModelPath, 'fake default model');
      writeFileSync(serverPath, 'fake server');

      const result = await service.benchmark('second-local-model', { timeoutMs: 2000 });

      expect(result.ok).toBe(true);
      expect(result.modelId).toBe('second-local-model');
      expect(result.firstTokenMs).toBeGreaterThanOrEqual(0);
      expect(result.tokensPerSecond).toBeGreaterThan(0);
      expect(launches.at(-1).args).toContain(selectedModelPath);
      expect(launches.at(-1).args).not.toContain(defaultModelPath);
      service.stop();
    } finally {
      await spawn.closeAll();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('installs the Caul-managed MLX runtime and prepares the MLX model on Apple Silicon', async () => {
    const root = mkdtempSync(join(tmpdir(), 'caul-local-mlx-test-'));
    const progressEvents = [];

    try {
      const service = createLocalLlmService({
        app: { getPath: () => root },
        catalogue: createMlxOnlyCatalogue(),
        emitStatus: (status) => {
          if (status.progress) {
            progressEvents.push(status.progress);
          }
        },
        spawn: fakeMlxSpawn(root),
        spawnSync: fakeMlxSpawnSync()
      });
      if (process.platform !== 'darwin' || process.arch !== 'arm64') {
        expect(service.status().runtime.supported).toBe(false);
        return;
      }

      const status = await service.download();

      expect(status.provider).toBe('caul-mlx');
      expect(status.runtime.installed).toBe(process.platform === 'darwin' && process.arch === 'arm64');
      expect(status.model.id).toBe('qwen3-1.7b-mlx-4bit');
      expect(progressEvents.map((progress) => progress.label)).toContain('Finalising local AI model');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('does not run a validation prompt during MLX model download', async () => {
    const root = mkdtempSync(join(tmpdir(), 'caul-local-mlx-test-'));
    const requests = [];

    try {
      const service = createLocalLlmService({
        app: { getPath: () => root },
        catalogue: createMlxOnlyCatalogue(),
        spawn: fakeMlxSpawn(root, { requests }),
        spawnSync: fakeMlxSpawnSync()
      });
      if (process.platform !== 'darwin' || process.arch !== 'arm64') {
        expect(service.status().runtime.supported).toBe(false);
        return;
      }

      await service.download();

      expect(requests).toHaveLength(0);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('disables Qwen3 thinking for MLX local AI requests', async () => {
    const root = mkdtempSync(join(tmpdir(), 'caul-local-mlx-test-'));
    const requests = [];

    try {
      const service = createLocalLlmService({
        app: { getPath: () => root },
        catalogue: createMlxOnlyCatalogue(),
        spawn: fakeMlxSpawn(root, { requests }),
        spawnSync: fakeMlxSpawnSync()
      });
      if (process.platform !== 'darwin' || process.arch !== 'arm64') {
        expect(service.status().runtime.supported).toBe(false);
        return;
      }

      await service.download();
      const response = await service.request('Reply with exactly: OK.', { onDelta: () => undefined });

      expect(response).toBe('OK');
      expect(requests.at(-1).messages.at(-1).content).toContain('/no_think');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('warms the loopback MLX server without sending a chat completion', async () => {
    const root = mkdtempSync(join(tmpdir(), 'caul-local-mlx-test-'));
    const requests = [];

    try {
      const serverPath = join(root, 'local-llm', 'runtimes', 'mlx-lm', 'venv', process.platform === 'win32' ? 'Scripts' : 'bin', process.platform === 'win32' ? 'mlx_lm.server.exe' : 'mlx_lm.server');
      const modelPath = join(root, 'local-llm', 'runtimes', 'mlx-lm', 'cache', 'huggingface', 'hub', 'models--test--mlx-model', 'snapshots', 'abc123');
      mkdirSync(dirname(serverPath), { recursive: true });
      mkdirSync(modelPath, { recursive: true });
      writeFileSync(serverPath, 'fake mlx server');
      writeFileSync(join(modelPath, 'config.json'), '{}');
      writeFileSync(join(modelPath, 'model.safetensors'), 'fake weights');

      const service = createLocalLlmService({
        app: { getPath: () => root },
        catalogue: createMlxOnlyCatalogue(),
        spawn: fakeMlxSpawn(root, { requests }),
        spawnSync: fakeMlxSpawnSync()
      });
      if (process.platform !== 'darwin' || process.arch !== 'arm64') {
        expect(service.status().runtime.supported).toBe(false);
        return;
      }

      const status = await service.warm();

      expect(status.status).toBe('warm');
      expect(requests).toHaveLength(0);
      service.stop();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('does not run synchronous process checks while reporting installed MLX status', () => {
    const root = mkdtempSync(join(tmpdir(), 'caul-local-mlx-test-'));

    try {
      const serverPath = join(root, 'local-llm', 'runtimes', 'mlx-lm', 'venv', process.platform === 'win32' ? 'Scripts' : 'bin', process.platform === 'win32' ? 'mlx_lm.server.exe' : 'mlx_lm.server');
      const modelPath = join(root, 'local-llm', 'runtimes', 'mlx-lm', 'cache', 'huggingface', 'hub', 'models--test--mlx-model', 'snapshots', 'abc123');
      mkdirSync(dirname(serverPath), { recursive: true });
      mkdirSync(modelPath, { recursive: true });
      writeFileSync(serverPath, 'fake mlx server');
      writeFileSync(join(modelPath, 'config.json'), '{}');
      writeFileSync(join(modelPath, 'model.safetensors'), 'fake weights');

      const service = createLocalLlmService({
        app: { getPath: () => root },
        catalogue: createMlxOnlyCatalogue(),
        spawnSync: () => {
          throw new Error('spawnSync should not run during status checks');
        }
      });
      const status = service.status();

      expect(status.provider).toBe('caul-mlx');
      expect(status.runtime.version).toBe('installed');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('does not report MLX ready while Hugging Face weight blobs are incomplete', () => {
    const root = mkdtempSync(join(tmpdir(), 'caul-local-mlx-test-'));

    try {
      const serverPath = join(root, 'local-llm', 'runtimes', 'mlx-lm', 'venv', process.platform === 'win32' ? 'Scripts' : 'bin', process.platform === 'win32' ? 'mlx_lm.server.exe' : 'mlx_lm.server');
      const modelRoot = join(root, 'local-llm', 'runtimes', 'mlx-lm', 'cache', 'huggingface', 'hub', 'models--test--mlx-model');
      const modelPath = join(modelRoot, 'snapshots', 'abc123');
      const blobPath = join(modelRoot, 'blobs');
      mkdirSync(dirname(serverPath), { recursive: true });
      mkdirSync(modelPath, { recursive: true });
      mkdirSync(blobPath, { recursive: true });
      writeFileSync(serverPath, 'fake mlx server');
      writeFileSync(join(modelPath, 'config.json'), '{}');
      writeFileSync(join(modelPath, 'model.safetensors'), 'fake weights');
      writeFileSync(join(blobPath, 'abc.incomplete'), 'partial weights');

      const service = createLocalLlmService({
        app: { getPath: () => root },
        catalogue: createMlxOnlyCatalogue(),
        spawnSync: fakeMlxSpawnSync()
      });

      expect(service.status().status).toBe('missing');
      expect(service.status().model.installed).toBe(false);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
