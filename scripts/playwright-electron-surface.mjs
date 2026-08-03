export function isMainElectronSurfaceUrl(candidate) {
  try {
    const url = new URL(candidate);
    return url.protocol === 'file:' && !url.searchParams.has('caul-surface');
  } catch {
    return false;
  }
}

export async function waitForMainElectronSurface(application, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const page = application.windows().find((candidate) => isMainElectronSurfaceUrl(candidate.url()));
    if (page) {
      await page.waitForFunction(() => Boolean(window.caul?.settings?.updates), undefined, {
        timeout: Math.max(1, deadline - Date.now())
      });
      return page;
    }

    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }

  const observedUrls = application.windows().map((page) => page.url());
  throw new Error(`Timed out waiting for the main Electron surface. Observed: ${observedUrls.join(', ') || 'no windows'}`);
}

export async function waitForUpdaterElectronSurface(
  application,
  { mainSurfaceRequired, timeoutMs = 60_000 }
) {
  if (mainSurfaceRequired) {
    return waitForMainElectronSurface(application, timeoutMs);
  }

  const page = await application.firstWindow({ timeout: timeoutMs });
  await page.waitForFunction(() => Boolean(window.caul?.settings?.updates), undefined, {
    timeout: timeoutMs
  });
  return page;
}
