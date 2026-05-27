import { useEffect, useState } from 'react';
import { getRuntimeContext, type RuntimeContext } from '../foundation/runtime';

export function useRuntimeContext() {
  const [context, setContext] = useState<RuntimeContext | null>(null);

  useEffect(() => {
    getRuntimeContext().then(setContext);
  }, []);

  return context;
}
