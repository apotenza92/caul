const fsSync = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { spawn: nodeSpawn, spawnSync: nodeSpawnSync } = require('node:child_process');

function createLocalLlmService({
  app,
  catalogue,
  fs = fsSync,
  httpModule = http,
  httpsModule = https,
  osModule = os,
  pathModule = path,
  spawn = nodeSpawn,
  spawnSync = nodeSpawnSync,
  emitStatus = () => undefined
}) {
  let activeDownload = null;
  let serverProcess = null;
  let serverPort = null;
  let serverModelPath = null;
  let serverStartedAt = 0;
  let warmState = {
    error: null,
    modelId: null,
    modelPath: null,
    promise: null,
    status: null
  };

  function getRoot() {
    return pathModule.join(app.getPath('userData'), 'local-llm');
  }

  function getRuntimeRoot() {
    return pathModule.join(getRoot(), 'runtimes', 'llama.cpp');
  }

  function getMlxRoot() {
    return pathModule.join(getRoot(), 'runtimes', 'mlx-lm');
  }

  function getMlxToolRoot() {
    return pathModule.join(getMlxRoot(), 'venv');
  }

  function getMlxCacheRoot() {
    return pathModule.join(getMlxRoot(), 'cache');
  }

  function getMlxModelRoot() {
    return pathModule.join(getMlxCacheRoot(), 'huggingface', 'hub');
  }

  function getModelRoot() {
    return pathModule.join(getRoot(), 'models');
  }

  function getEligibleLocalModels() {
    return catalogue.aiResponse.filter((model) => (
      model.local
      && model.implemented
      && model.caulSmokeStatus !== 'failed-basic-instruction'
      && (!Array.isArray(model.platforms) || model.platforms.includes(process.platform))
    ));
  }

  function getRecommendedModel() {
    const localModels = getEligibleLocalModels();
    const mlxModel = localModels.find((model) => model.runtime === 'mlx-lm' && process.platform === 'darwin' && process.arch === 'arm64');

    return mlxModel
      ?? localModels.find((model) => model.runtime === 'llama.cpp')
      ?? null;
  }

  function getModelById(modelId) {
    if (!modelId) {
      return null;
    }

    return getEligibleLocalModels().find((model) => model.id === modelId) ?? null;
  }

  function resolveModel(modelId = null) {
    return getModelById(modelId) ?? getRecommendedModel();
  }

  function getRuntimeAsset() {
    const runtime = catalogue.runtimes?.llamaCpp;
    const key = `${process.platform}-${process.arch}`;

    return runtime?.assets?.[key] ?? null;
  }

  function getModelPath(model = resolveModel()) {
    if (model?.runtime === 'mlx-lm') {
      return pathModule.join(getMlxModelRoot(), `models--${String(model.providerModelId ?? model.id).replace(/\//g, '--')}`);
    }

    return model ? pathModule.join(getModelRoot(), model.fileName) : null;
  }

  function getServerPath() {
    const executableName = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
    return findFile(getRuntimeRoot(), executableName);
  }

  function status(modelId = null) {
    const model = resolveModel(modelId);
    if (model?.runtime === 'mlx-lm') {
      return getMlxStatus(model);
    }

    const modelPath = getModelPath(model);
    const serverPath = getServerPath();
    const runtimeAsset = getRuntimeAsset();
    const runtimeInstalled = Boolean(serverPath);
    const modelInstalled = Boolean(modelPath && fs.existsSync(modelPath));
    const modelDownloading = Boolean(activeDownload && model?.id === activeDownload.modelId);
    const warmStatus = getWarmStatus(model, modelPath);

    return {
      ok: true,
      provider: 'caul-llama.cpp',
      status: modelDownloading ? 'downloading' : (warmStatus ?? (runtimeInstalled && modelInstalled ? 'ready' : 'missing')),
      runtime: {
        assetName: runtimeAsset?.archiveName ?? null,
        installed: runtimeInstalled,
        path: serverPath,
        supported: Boolean(runtimeAsset),
        version: catalogue.runtimes?.llamaCpp?.version ?? null
      },
      model: model
        ? {
          id: model.id,
          installed: modelInstalled,
          name: model.name,
          path: modelPath,
          sizeGb: model.downloadSizeGb
        }
        : null,
      progress: modelDownloading ? activeDownload?.progress : undefined
    };
  }

  async function download(modelId = null) {
    if (activeDownload) {
      return status(activeDownload.modelId);
    }

    const model = resolveModel(modelId);
    if (model?.runtime === 'mlx-lm') {
      return downloadMlx(model);
    }

    const runtimeAsset = getRuntimeAsset();

    if (!model) {
      throw new Error('No Caul-managed local AI model is available for this build.');
    }

    if (!runtimeAsset) {
      throw new Error(`Caul-managed local AI is not available for ${process.platform}/${process.arch}.`);
    }

    const downloadState = {
      modelId: model.id,
      progress: {
        downloadedBytes: 0,
        label: 'Preparing local AI runtime',
        percent: 0,
        phase: 'runtime',
        totalBytes: runtimeAsset.sizeBytes ?? null
      },
      request: null
    };
    activeDownload = downloadState;
    emitStatus(status(model.id));

    const needsRuntime = !getServerPath();
    const needsModel = !fs.existsSync(getModelPath(model));

    try {
      if (needsRuntime) {
        await downloadRuntime(runtimeAsset, downloadState, {
          end: needsModel ? 24 : 100,
          start: 0
        });
      }

      if (needsModel) {
        await downloadModel(model, downloadState, {
          end: 100,
          start: needsRuntime ? 25 : 0
        });
      }
    } finally {
      activeDownload = null;
      emitStatus(status(model.id));
    }

    return status(model.id);
  }

  function cancelDownload() {
    const cancelledModelId = activeDownload?.modelId ?? null;
    if (activeDownload?.request) {
      activeDownload.request.destroy(new Error('Local AI download cancelled.'));
    }

    activeDownload = null;
    emitStatus(status(cancelledModelId));

    return status(cancelledModelId);
  }

  function getMlxStatus(model = resolveModel()) {
    const serverPath = getMlxServerPath();
    const modelPath = getModelPath(model);
    const supported = process.platform === 'darwin' && process.arch === 'arm64';
    const runtimeInstalled = Boolean(serverPath);
    const modelInstalled = Boolean(modelPath && hasMlxSnapshot(modelPath));
    const modelDownloading = Boolean(activeDownload && model?.id === activeDownload.modelId);
    const warmStatus = getWarmStatus(model, modelPath);

    return {
      ok: true,
      provider: 'caul-mlx',
      status: modelDownloading ? 'downloading' : (warmStatus ?? (runtimeInstalled && modelInstalled ? 'ready' : 'missing')),
      runtime: {
        assetName: 'mlx-lm',
        installed: runtimeInstalled,
        path: serverPath,
        supported,
        version: getMlxVersion()
      },
      model: model
        ? {
          id: model.id,
          installed: modelInstalled,
          name: model.name,
          path: modelPath,
          sizeGb: model.downloadSizeGb
        }
        : null,
      progress: modelDownloading ? activeDownload?.progress : undefined
    };
  }

  function getWarmStatus(model, modelPath) {
    if (!model || !modelPath) {
      return null;
    }

    if (serverProcess && serverModelPath === modelPath && serverPort) {
      return 'warm';
    }

    if (warmState.modelId === model.id && warmState.modelPath === modelPath) {
      return warmState.status;
    }

    return null;
  }

  function getMlxServerPath() {
    const executableName = process.platform === 'win32' ? 'mlx_lm.server.exe' : 'mlx_lm.server';
    const toolPath = pathModule.join(
      getMlxToolRoot(),
      process.platform === 'win32' ? 'Scripts' : 'bin',
      executableName
    );

    return fs.existsSync(toolPath) ? toolPath : null;
  }

  function getMlxPythonPath() {
    return pathModule.join(
      getMlxToolRoot(),
      process.platform === 'win32' ? 'Scripts' : 'bin',
      process.platform === 'win32' ? 'python.exe' : 'python'
    );
  }

  function getMlxHfPath() {
    return pathModule.join(
      getMlxToolRoot(),
      process.platform === 'win32' ? 'Scripts' : 'bin',
      process.platform === 'win32' ? 'hf.exe' : 'hf'
    );
  }

  function getMlxVersion() {
    const serverPath = getMlxServerPath();

    return serverPath ? 'installed' : null;
  }

  async function downloadMlx(model) {
    if (activeDownload) {
      return status(activeDownload.modelId);
    }

    if (process.platform !== 'darwin' || process.arch !== 'arm64') {
      throw new Error('Caul-managed MLX local AI is available only on Apple Silicon Macs.');
    }

    try {
      await runCommand('uv', ['--version'], 'Caul-managed MLX local AI requires uv. Install uv or use the llama.cpp local model for now.', { timeoutMs: 1500 });
    } catch {
      throw new Error('Caul-managed MLX local AI requires uv. Install uv or use the llama.cpp local model for now.');
    }

    const downloadState = {
      modelId: model.id,
      progress: {
        downloadedBytes: 0,
        label: 'Preparing MLX local AI runtime',
        percent: 0,
        phase: 'runtime',
        totalBytes: null
      },
      request: null
    };
    activeDownload = downloadState;
    emitStatus(status(model.id));

    try {
      const needsRuntime = !getMlxServerPath();
      const needsModel = !hasMlxSnapshot(getModelPath(model));

      if (needsRuntime) {
        await installMlxRuntime(downloadState, {
          end: needsModel ? 25 : 100,
          start: 0
        });
      }

      if (needsModel) {
        await downloadMlxModel(model, {
          end: 100,
          start: needsRuntime ? 26 : 0
        }, downloadState);
      }
    } finally {
      activeDownload = null;
      emitStatus(status(model.id));
    }

    return status(model.id);
  }

  async function installMlxRuntime(downloadState, progressRange = { end: 100, start: 0 }) {
    fs.mkdirSync(getMlxToolRoot(), { recursive: true });
    fs.mkdirSync(getMlxCacheRoot(), { recursive: true });
    setDownloadProgress(downloadState, {
      downloadedBytes: 0,
      label: 'Preparing local AI',
      percent: progressRange.start,
      phase: 'runtime',
      totalBytes: null
    });
    emitStatus(status(downloadState.modelId));
    await runCommand('uv', [
      'venv',
      '--clear',
      getMlxToolRoot()
    ], 'Failed to prepare MLX local AI runtime.', { env: getMlxEnv() });
    setDownloadProgress(downloadState, {
      downloadedBytes: 0,
      label: 'Installing local AI runtime',
      percent: Math.round(progressRange.start + ((progressRange.end - progressRange.start) * 0.45)),
      phase: 'runtime',
      totalBytes: null
    });
    emitStatus(status(downloadState.modelId));
    await runCommand('uv', [
      'pip',
      'install',
      '--python',
      getMlxPythonPath(),
      'mlx-lm'
    ], 'Failed to install MLX local AI runtime.', { env: getMlxEnv() });
    setDownloadProgress(downloadState, {
      downloadedBytes: 0,
      label: 'Installed local AI runtime',
      percent: progressRange.end,
      phase: 'runtime',
      totalBytes: null
    });
    emitStatus(status(downloadState.modelId));
  }

  async function downloadMlxModel(model, progressRange = { end: 100, start: 0 }, downloadState) {
    fs.mkdirSync(getMlxCacheRoot(), { recursive: true });
    const totalBytes = Math.round((model.downloadSizeGb ?? 0) * 1024 * 1024 * 1024) || null;
    setDownloadProgress(downloadState, {
      downloadedBytes: 0,
      label: 'Downloading local AI model',
      percent: progressRange.start,
      phase: 'model',
      totalBytes
    });
    emitStatus(status(downloadState.modelId));
    const stopProgressPolling = startMlxModelProgressPolling(model, downloadState, progressRange, totalBytes);
    try {
      await runCommand(getMlxHfPath(), [
        'download',
        model.providerModelId
      ], 'Failed to download MLX local AI model.', { env: getMlxEnv() });
      await waitForMlxSnapshotComplete(model, Math.max(60_000, Number(process.env.CAUL_LOCAL_LLM_MODEL_DOWNLOAD_TIMEOUT_MS ?? 30 * 60_000)));
    } finally {
      stopProgressPolling();
    }
    if (!hasMlxSnapshot(getModelPath(model))) {
      throw new Error('MLX local AI model did not download into the Caul model cache.');
    }
    setDownloadProgress(downloadState, {
      downloadedBytes: downloadState.progress.totalBytes ?? 0,
      label: 'Downloaded local AI model',
      percent: progressRange.end,
      phase: 'model',
      totalBytes
    });
    emitStatus(status(downloadState.modelId));
  }

  function startMlxModelProgressPolling(model, downloadState, progressRange, totalBytes) {
    if (!totalBytes) {
      return () => undefined;
    }

    let stopped = false;
    let timer = null;
    const modelPath = getModelPath(model);
    const poll = () => {
      if (stopped) {
        return;
      }

      const downloadedBytes = getDirectorySizeBytes(modelPath);
      const transferPercent = Math.min(99, Math.round((downloadedBytes / totalBytes) * 100));
      setDownloadProgress(downloadState, {
        downloadedBytes,
        label: 'Downloading local AI model',
        percent: mapDownloadPercent(transferPercent, {
          overallEnd: progressRange.end,
          overallStart: progressRange.start
        }),
        phase: 'model',
        totalBytes
      });
      emitStatus(status(downloadState.modelId));
      timer = setTimeout(poll, 750);
      timer.unref?.();
    };

    poll();

    return () => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }

  function getDirectorySizeBytes(directoryPath) {
    try {
      const stats = fs.statSync(directoryPath);
      if (stats.isFile()) {
        return stats.size;
      }
      if (!stats.isDirectory()) {
        return 0;
      }

      return fs.readdirSync(directoryPath).reduce((total, entry) => (
        total + getDirectorySizeBytes(pathModule.join(directoryPath, entry))
      ), 0);
    } catch {
      return 0;
    }
  }

  function getMlxEnv() {
    return {
      ...process.env,
      HF_HOME: pathModule.join(getMlxCacheRoot(), 'huggingface'),
      UV_CACHE_DIR: pathModule.join(getMlxCacheRoot(), 'uv')
    };
  }

  async function waitForMlxSnapshotComplete(model, timeoutMs) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      if (hasMlxSnapshot(getModelPath(model))) {
        return;
      }

      await wait(1000);
    }

    throw new Error('MLX local AI model download did not finish before the timeout.');
  }

  async function downloadRuntime(runtimeAsset, downloadState, progressRange = { end: 100, start: 0 }) {
    fs.mkdirSync(getRuntimeRoot(), { recursive: true });
    const archivePath = pathModule.join(getRuntimeRoot(), runtimeAsset.archiveName);
    const temporaryPath = `${archivePath}.download`;

    await downloadFile(runtimeAsset.url, temporaryPath, downloadState, {
      label: 'Downloading local AI runtime',
      overallEnd: Math.max(progressRange.start, progressRange.end - 4),
      overallStart: progressRange.start,
      phase: 'runtime',
      totalBytes: runtimeAsset.sizeBytes ?? null
    });

    fs.renameSync(temporaryPath, archivePath);
    setDownloadProgress(downloadState, {
      downloadedBytes: runtimeAsset.sizeBytes ?? 0,
      label: 'Installing local AI runtime',
      percent: Math.max(progressRange.start, progressRange.end - 2),
      phase: 'runtime',
      totalBytes: runtimeAsset.sizeBytes ?? null
    });
    emitStatus(status(downloadState.modelId));
    await extractArchive(archivePath, getRuntimeRoot());
    fs.rmSync(archivePath, { force: true });
    const serverPath = getServerPath();

    if (!serverPath) {
      throw new Error('Downloaded local AI runtime did not contain llama-server.');
    }

    if (process.platform !== 'win32') {
      fs.chmodSync(serverPath, 0o755);
    }
    setDownloadProgress(downloadState, {
      downloadedBytes: runtimeAsset.sizeBytes ?? 0,
      label: 'Installed local AI runtime',
      percent: progressRange.end,
      phase: 'runtime',
      totalBytes: runtimeAsset.sizeBytes ?? null
    });
    emitStatus(status(downloadState.modelId));
  }

  async function downloadModel(model, downloadState, progressRange = { end: 100, start: 0 }) {
    fs.mkdirSync(getModelRoot(), { recursive: true });
    const modelPath = getModelPath(model);
    const temporaryPath = `${modelPath}.download`;

    await downloadFile(model.downloadUrl, temporaryPath, downloadState, {
      label: 'Downloading local AI model',
      overallEnd: progressRange.end,
      overallStart: progressRange.start,
      phase: 'model',
      totalBytes: Math.round((model.downloadSizeGb ?? 0) * 1024 * 1024 * 1024) || null
    });

    fs.renameSync(temporaryPath, modelPath);
  }

  function downloadFile(url, destinationPath, downloadState, progressBase) {
    return new Promise((resolve, reject) => {
      fs.rmSync(destinationPath, { force: true });
      fs.mkdirSync(pathModule.dirname(destinationPath), { recursive: true });
      const file = fs.createWriteStream(destinationPath);

      const request = httpsModule.get(url, { agent: false }, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          file.close();
          fs.rmSync(destinationPath, { force: true });
          downloadFile(new URL(response.headers.location, url).toString(), destinationPath, downloadState, progressBase)
            .then(resolve, reject);
          return;
        }

        if (response.statusCode !== 200) {
          file.close();
          fs.rmSync(destinationPath, { force: true });
          reject(new Error(`Download failed with HTTP ${response.statusCode}.`));
          return;
        }

        const totalBytes = Number(response.headers['content-length']) || progressBase.totalBytes;
        let downloadedBytes = 0;
        let lastEmittedPercent = -1;
        let lastEmittedAt = 0;

        response.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          const transferPercent = totalBytes ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : 0;
          const percent = mapDownloadPercent(transferPercent, progressBase);
          const now = Date.now();
          setDownloadProgress(downloadState, {
            downloadedBytes,
            label: progressBase.label,
            percent,
            phase: progressBase.phase,
            totalBytes
          });
          if (percent !== lastEmittedPercent || now - lastEmittedAt > 500) {
            lastEmittedPercent = percent;
            lastEmittedAt = now;
            emitStatus(status(downloadState.modelId));
          }
        });

        response.pipe(file);
        file.once('finish', () => {
          emitStatus(status(downloadState.modelId));
          file.close(resolve);
        });
      });

      downloadState.request = request;
      request.once('error', (error) => {
        file.close();
        fs.rmSync(destinationPath, { force: true });
        reject(error);
      });
    });
  }

  function setDownloadProgress(downloadState, progress) {
    downloadState.progress = {
      downloadedBytes: progress.downloadedBytes,
      label: progress.label,
      percent: clampPercent(progress.percent),
      phase: progress.phase,
      totalBytes: progress.totalBytes
    };
  }

  function mapDownloadPercent(percent, progressBase) {
    if (Number.isFinite(progressBase.overallStart) && Number.isFinite(progressBase.overallEnd)) {
      const start = clampPercent(progressBase.overallStart);
      const end = clampPercent(progressBase.overallEnd);

      return Math.round(start + ((end - start) * (clampPercent(percent) / 100)));
    }

    return clampPercent(percent);
  }

  function clampPercent(percent) {
    return Math.max(0, Math.min(100, Math.round(Number.isFinite(percent) ? percent : 0)));
  }

  function extractArchive(archivePath, destinationPath) {
    if (archivePath.endsWith('.tar.gz')) {
      return runCommand('tar', ['-xzf', archivePath, '-C', destinationPath], 'Failed to extract local AI runtime.');
    }

    if (archivePath.endsWith('.zip')) {
      if (process.platform === 'win32') {
        return runCommand('powershell.exe', [
          '-NoProfile',
          '-Command',
          `Expand-Archive -Force ${JSON.stringify(archivePath)} ${JSON.stringify(destinationPath)}`
        ], 'Failed to extract local AI runtime.');
      }

      return runCommand('unzip', ['-o', archivePath, '-d', destinationPath], 'Failed to extract local AI runtime.');
    }

    return Promise.reject(new Error('Unsupported local AI runtime archive format.'));
  }

  function runCommand(command, args, message, { env = process.env, timeoutMs = 0, allowTimeout = false } = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { env, stdio: ['ignore', 'ignore', 'pipe'] });
      const errors = [];
      const timer = timeoutMs > 0
        ? setTimeout(() => {
          child.kill();
          if (allowTimeout) {
            resolve();
          } else {
            reject(new Error(message));
          }
        }, timeoutMs)
        : null;

      child.stderr.on('data', (chunk) => errors.push(chunk.toString()));
      child.once('error', reject);
      child.once('exit', (code) => {
        if (timer) {
          clearTimeout(timer);
        }
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(errors.join('').trim() || message));
        }
      });
    });
  }

  async function request(prompt, { modelId = null, onDelta = () => undefined, signal } = {}) {
    const model = resolveModel(modelId);
    if (model?.runtime === 'mlx-lm') {
      return requestMlx(prompt, model, { onDelta, signal });
    }

    const modelPath = getModelPath(model);

    if (!model || !modelPath || !fs.existsSync(modelPath) || !getServerPath()) {
      throw new Error('Local AI is not ready. Download the local AI runtime and model in onboarding or Settings.');
    }

    const port = await ensureServer(modelPath);

    return requestChatCompletion(port, prompt, { onDelta, signal });
  }

  async function warm(modelId = null) {
    const model = resolveModel(modelId);
    const currentStatus = status(model?.id ?? modelId);

    if (!model || currentStatus.status === 'missing' || currentStatus.status === 'downloading') {
      return currentStatus;
    }

    const modelPath = getModelPath(model);
    if (serverProcess && serverModelPath === modelPath && serverPort) {
      return status(model.id);
    }

    if (warmState.promise && warmState.modelId === model.id && warmState.modelPath === modelPath) {
      return warmState.promise;
    }

    warmState = {
      error: null,
      modelId: model.id,
      modelPath,
      promise: null,
      status: 'warming'
    };
    emitStatus(status(model.id));

    const warmPromise = (async () => {
      try {
        if (model.runtime === 'mlx-lm') {
          await ensureMlxServer(model);
        } else {
          await ensureServer(modelPath);
        }

        warmState = {
          error: null,
          modelId: model.id,
          modelPath,
          promise: null,
          status: 'warm'
        };
        emitStatus(status(model.id));
        return status(model.id);
      } catch (error) {
        warmState = {
          error,
          modelId: model.id,
          modelPath,
          promise: null,
          status: 'error'
        };
        emitStatus(status(model.id));
        return status(model.id);
      }
    })();

    warmState = {
      error: null,
      modelId: model.id,
      modelPath,
      promise: warmPromise,
      status: 'warming'
    };

    return warmPromise;
  }

  async function benchmark(modelId = null, {
    prompt = 'Reply with one short sentence about a meeting action item.',
    timeoutMs = 12_000
  } = {}) {
    const model = resolveModel(modelId);
    const startedAt = Date.now();
    let firstTokenMs = null;
    let outputText = '';
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      if (!model) {
        throw new Error('No Caul-managed local AI model is available for this build.');
      }

      const statusBefore = status(model.id);
      if (statusBefore.status !== 'ready' && statusBefore.status !== 'warm') {
        throw new Error('Local AI model is not ready for benchmarking.');
      }

      outputText = await request(prompt, {
        modelId: model.id,
        onDelta: (delta) => {
          if (firstTokenMs === null && delta.trim()) {
            firstTokenMs = Date.now() - startedAt;
          }
        },
        signal: controller.signal
      });

      const totalMs = Date.now() - startedAt;
      const outputTokens = Math.max(1, outputText.split(/\s+/).filter(Boolean).length);

      return {
        failureReason: null,
        firstTokenMs: firstTokenMs ?? totalMs,
        modelId: model.id,
        ok: true,
        status: 'passed',
        tokensPerSecond: Math.round((outputTokens / Math.max(1, totalMs / 1000)) * 10) / 10,
        totalMs
      };
    } catch (error) {
      return {
        failureReason: error.message,
        firstTokenMs,
        modelId: model?.id ?? modelId ?? null,
        ok: false,
        status: 'failed',
        tokensPerSecond: 0,
        totalMs: Date.now() - startedAt
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async function ensureServer(modelPath) {
    if (serverProcess && serverModelPath === modelPath && serverPort) {
      return serverPort;
    }

    stop();

    const selectedPort = await getAvailablePort();
    serverPort = selectedPort;
    serverModelPath = modelPath;
    serverStartedAt = Date.now();
    serverProcess = spawn(getServerPath(), [
      '--host', '127.0.0.1',
      '--port', String(selectedPort),
      '--model', modelPath,
      '--ctx-size', '8192',
      '--threads', String(Math.max(2, Math.min(8, osModule.cpus().length))),
      '--jinja',
      '--no-webui'
    ], {
      cwd: getRoot(),
      stdio: ['ignore', 'ignore', 'pipe']
    });
    serverProcess.stderr.on('data', (chunk) => {
      if (process.env.CAUL_LOCAL_LLM_DEBUG === '1') {
        console.error(`caul-local-llm ${chunk.toString().trim()}`);
      }
    });
    serverProcess.stderr.unref?.();
    serverProcess.unref?.();
    serverProcess.once('exit', () => {
      serverProcess = null;
      serverPort = null;
      serverModelPath = null;
    });

    await waitForServer(selectedPort, Math.max(10_000, Number(process.env.CAUL_LOCAL_LLM_START_TIMEOUT_MS ?? 90_000)));

    return selectedPort;
  }

  async function requestMlx(prompt, model, { onDelta, signal }) {
    if (!getMlxServerPath() || !hasMlxSnapshot(getModelPath(model))) {
      throw new Error('MLX local AI is not ready. Download the local AI runtime and model in onboarding or Settings.');
    }

    const port = await ensureMlxServer(model);
    const requestPrompt = shouldDisableThinkingForModel(model) && !prompt.includes('/no_think')
      ? `${prompt}\n\n/no_think`
      : prompt;

    return requestChatCompletion(port, requestPrompt, { modelId: model.providerModelId, onDelta, signal });
  }

  function shouldDisableThinkingForModel(model) {
    const modelId = `${model?.id ?? ''} ${model?.providerModelId ?? ''}`.toLowerCase();

    return modelId.includes('qwen3');
  }

  async function ensureMlxServer(model) {
    const modelPath = getModelPath(model);
    if (serverProcess && serverModelPath === modelPath && serverPort) {
      return serverPort;
    }

    stop();

    const selectedPort = await getAvailablePort();
    serverPort = selectedPort;
    serverModelPath = modelPath;
    serverStartedAt = Date.now();
    serverProcess = spawn(getMlxServerPath(), [
      '--host', '127.0.0.1',
      '--port', String(selectedPort),
      '--model',
      model.providerModelId
    ], {
      cwd: getRoot(),
      env: getMlxEnv(),
      stdio: ['ignore', 'ignore', 'pipe']
    });
    serverProcess.stderr.on('data', (chunk) => {
      if (process.env.CAUL_LOCAL_LLM_DEBUG === '1') {
        console.error(`caul-local-mlx ${chunk.toString().trim()}`);
      }
    });
    serverProcess.stderr.unref?.();
    serverProcess.unref?.();
    serverProcess.once('exit', () => {
      serverProcess = null;
      serverPort = null;
      serverModelPath = null;
    });

    await waitForServer(selectedPort, Math.max(10_000, Number(process.env.CAUL_LOCAL_LLM_START_TIMEOUT_MS ?? 90_000)));

    return selectedPort;
  }

  function stop() {
    if (serverProcess) {
      serverProcess.kill();
      serverProcess.stderr.unref?.();
      serverProcess.unref?.();
    }

    serverProcess = null;
    serverPort = null;
    serverModelPath = null;
    warmState = {
      error: null,
      modelId: null,
      modelPath: null,
      promise: null,
      status: null
    };
  }

  function getAvailablePort() {
    return new Promise((resolve, reject) => {
      const server = httpModule.createServer();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : 0;
        server.close(() => resolve(port));
      });
    });
  }

  async function waitForServer(port, timeoutMs) {
    const startedAt = Date.now();
    let lastError = null;

    while (Date.now() - startedAt < timeoutMs) {
      try {
        await httpJson(port, '/health', null, { timeoutMs: 1000 });
        return;
      } catch (error) {
        lastError = error;
        await wait(250);
      }
    }

    throw new Error(`Local AI runtime did not become ready after ${Math.round((Date.now() - serverStartedAt) / 1000)}s: ${lastError?.message ?? 'unknown error'}`);
  }

  function requestChatCompletion(port, prompt, { modelId = 'local-model', onDelta, signal }) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('Local AI request cancelled.'));
        return;
      }

      const request = httpModule.request({
        agent: false,
        hostname: '127.0.0.1',
        method: 'POST',
        path: '/v1/chat/completions',
        port: Number(port),
        headers: {
          'Content-Type': 'application/json'
        }
      }, (response) => {
        if (response.statusCode !== 200) {
          const errors = [];
          response.on('data', (chunk) => errors.push(chunk.toString()));
          response.on('end', () => {
            signal?.removeEventListener?.('abort', abortRequest);
            reject(new Error(errors.join('').trim() || `Local AI request failed with HTTP ${response.statusCode}.`));
          });
          return;
        }

        const output = [];
        let buffer = '';
        response.on('data', (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line.startsWith('data:')) {
              continue;
            }

            const data = line.slice('data:'.length).trim();
            if (!data || data === '[DONE]') {
              continue;
            }

            try {
              const payload = JSON.parse(data);
              const delta = payload.choices?.[0]?.delta?.content ?? payload.choices?.[0]?.message?.content ?? '';
              if (delta) {
                output.push(delta);
                onDelta(delta);
              }
            } catch {
              // Ignore malformed stream keepalive lines.
            }
          }
        });
        response.on('end', () => {
          signal?.removeEventListener?.('abort', abortRequest);
          resolve(output.join('').trim() || 'No response returned.');
        });
      });

      function abortRequest() {
        request.destroy(new Error('Local AI request cancelled.'));
      }

      signal?.addEventListener?.('abort', abortRequest, { once: true });
      request.once('error', (error) => {
        signal?.removeEventListener?.('abort', abortRequest);
        reject(error);
      });
      request.end(JSON.stringify({
        messages: [
          {
            role: 'system',
            content: 'Answer concisely and helpfully for a live call assistant.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        model: modelId,
        max_tokens: 64,
        stream: true,
        temperature: 0.3
      }));
    });
  }

  function httpJson(port, requestPath, body, { timeoutMs = 1000 } = {}) {
    return new Promise((resolve, reject) => {
      const request = httpModule.request({
        agent: false,
        hostname: '127.0.0.1',
        method: body ? 'POST' : 'GET',
        path: requestPath,
        port,
        timeout: timeoutMs,
        headers: body ? { 'Content-Type': 'application/json' } : undefined
      }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolve(Buffer.concat(chunks).toString());
          } else {
            reject(new Error(`HTTP ${response.statusCode}`));
          }
        });
      });

      request.once('timeout', () => {
        request.destroy(new Error('HTTP request timed out.'));
      });
      request.once('error', reject);
      request.end(body ? JSON.stringify(body) : undefined);
    });
  }

  return {
    benchmark,
    cancelDownload,
    download,
    getModelById,
    getModelPath,
    getRecommendedModel,
    getRuntimeAsset,
    getServerPath,
    request,
    status,
    stop,
    warm
  };
}

function findFile(root, fileName) {
  try {
    if (!fsSync.existsSync(root)) {
      return null;
    }

    const entries = fsSync.readdirSync(root, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(root, entry.name);
      if (entry.isFile() && entry.name === fileName) {
        return entryPath;
      }

      if (entry.isDirectory()) {
        const nested = findFile(entryPath, fileName);
        if (nested) {
          return nested;
        }
      }
    }
  } catch {
    return null;
  }

  return null;
}

function hasMlxSnapshot(modelCachePath) {
  try {
    if (!modelCachePath || !fsSync.existsSync(modelCachePath)) {
      return false;
    }

    if (hasIncompleteHuggingFaceBlob(modelCachePath)) {
      return false;
    }

    const snapshotRoot = path.join(modelCachePath, 'snapshots');
    if (!fsSync.existsSync(snapshotRoot)) {
      return false;
    }

    return fsSync.readdirSync(snapshotRoot, { withFileTypes: true }).some((entry) => (
      entry.isDirectory()
        && fsSync.existsSync(path.join(snapshotRoot, entry.name, 'config.json'))
        && hasMlxWeightFile(path.join(snapshotRoot, entry.name))
    ));
  } catch {
    return false;
  }
}

function hasMlxWeightFile(directoryPath) {
  try {
    return fsSync.readdirSync(directoryPath, { withFileTypes: true }).some((entry) => {
      const entryPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        return hasMlxWeightFile(entryPath);
      }

      return /\.(safetensors|npz|bin)$/i.test(entry.name) && fsSync.existsSync(entryPath);
    });
  } catch {
    return false;
  }
}

function hasIncompleteHuggingFaceBlob(directoryPath) {
  try {
    return fsSync.readdirSync(directoryPath, { withFileTypes: true }).some((entry) => {
      const entryPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        return hasIncompleteHuggingFaceBlob(entryPath);
      }

      return /\.incomplete$/i.test(entry.name);
    });
  } catch {
    return false;
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  createLocalLlmService
};
