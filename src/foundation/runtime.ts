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
  appName: 'Susura',
  vmTestingTarget: 'Parallels macOS VM'
};

export async function getRuntimeContext(): Promise<RuntimeContext> {
  if (!window.susura) {
    return browserRuntimeContext;
  }

  try {
    return await window.susura.getRuntimeContext();
  } catch {
    return browserRuntimeContext;
  }
}
