function createStopFlushController({
  clearTimeoutFn = clearTimeout,
  setTimeoutFn = setTimeout,
  timeoutMs = 2500
} = {}) {
  let pending = null;

  function wait() {
    cancel('replaced');

    return new Promise((resolve) => {
      const timeout = setTimeoutFn(() => {
        finish('timeout');
      }, timeoutMs);

      if (typeof timeout?.unref === 'function') {
        timeout.unref();
      }

      pending = {
        resolve,
        timeout
      };
    });
  }

  function finish(reason) {
    if (!pending) {
      return false;
    }

    const current = pending;
    pending = null;
    clearTimeoutFn(current.timeout);
    current.resolve({ reason });

    return true;
  }

  function cancel(reason = 'cancelled') {
    return finish(reason);
  }

  return {
    cancel,
    resolve: () => finish('stopped'),
    wait
  };
}

module.exports = {
  createStopFlushController
};
