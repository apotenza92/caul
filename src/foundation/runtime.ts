export type RuntimeContext = {
  platform: string;
  arch: string;
  isMac: boolean;
  appChannel?: 'stable' | 'beta' | 'dev';
  appName?: string;
};

export const browserRuntimeContext: RuntimeContext = {
  platform: 'browser',
  arch: 'unknown',
  isMac: false,
  appChannel: 'stable',
  appName: 'Caul'
};

export async function getRuntimeContext(): Promise<RuntimeContext> {
  if (!window.caul) {
    return browserRuntimeContext;
  }

  try {
    return await window.caul.getRuntimeContext();
  } catch {
    return browserRuntimeContext;
  }
}
