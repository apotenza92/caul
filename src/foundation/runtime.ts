export type RuntimeContext = {
  platform: string;
  arch: string;
  isMac: boolean;
  appChannel?: 'stable' | 'beta' | 'dev';
  appName?: string;
  vmTestingTarget: string;
};

export const browserRuntimeContext: RuntimeContext = {
  platform: 'browser',
  arch: 'unknown',
  isMac: false,
  appChannel: 'stable',
  appName: 'Caul',
  vmTestingTarget: 'Parallels macOS VM'
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
