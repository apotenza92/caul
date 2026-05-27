export type RuntimeContext = {
  platform: string;
  arch: string;
  isMac: boolean;
  vmTestingTarget: string;
};

export const browserRuntimeContext: RuntimeContext = {
  platform: 'browser',
  arch: 'unknown',
  isMac: false,
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
