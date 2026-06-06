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

function createFakeLlamaSpawn() {
  const servers = new Set();

  const spawn = (_command, args) => {
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

function fakeMlxSpawn(root) {
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

      if (args.includes('--port')) {
        const port = Number(args[args.indexOf('--port') + 1]);
        const modelPath = join(root, 'local-llm', 'runtimes', 'mlx-lm', 'cache', 'huggingface', 'hub', 'models--test--mlx-model', 'snapshots', 'abc123');
        mkdirSync(modelPath, { recursive: true });
        writeFileSync(join(modelPath, 'config.json'), '{}');
        server = http.createServer((request, response) => {
          if (request.url === '/health') {
            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ status: 'ok' }));
            return;
          }

          if (request.url === '/v1/chat/completions' && request.method === 'POST') {
            request.resume();
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

  it('installs the Caul-managed MLX runtime and prepares the MLX model on Apple Silicon', async () => {
    const root = mkdtempSync(join(tmpdir(), 'caul-local-mlx-test-'));

    try {
      const service = createLocalLlmService({
        app: { getPath: () => root },
        catalogue: createMlxOnlyCatalogue(),
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
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
