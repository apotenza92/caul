const browserLoginMethod = 'browser';
const allowedAuthenticationHosts = new Set(['auth.openai.com']);

function isAllowedAuthenticationUrl(value) {
  try {
    const url = new URL(value);

    return url.protocol === 'https:' && allowedAuthenticationHosts.has(url.hostname);
  } catch {
    return false;
  }
}

function createBrowserLoginInteraction({ openExternal }) {
  let browserOpenError = null;
  let browserOpenPromise = Promise.resolve();

  return {
    notify(event) {
      if (event?.type !== 'auth_url' || !event.url) {
        return;
      }

      if (!isAllowedAuthenticationUrl(event.url)) {
        browserOpenError = new Error('Pi returned an unexpected ChatGPT authentication address.');
        return;
      }

      browserOpenPromise = Promise.resolve()
        .then(() => openExternal(event.url))
        .catch((error) => {
          browserOpenError = error;
        });
    },
    async prompt(prompt) {
      if (prompt?.type === 'select') {
        const browserOption = prompt.options?.find((option) => option.id === browserLoginMethod);

        if (!browserOption) {
          throw new Error('This version of Pi does not offer browser sign in.');
        }

        return browserOption.id;
      }

      if (prompt?.type === 'manual_code') {
        await browserOpenPromise;

        if (browserOpenError) {
          const message = browserOpenError instanceof Error
            ? browserOpenError.message
            : String(browserOpenError);
          throw new Error(`Could not open ChatGPT sign in: ${message}`);
        }

        return new Promise((resolve, reject) => {
          const signal = prompt.signal;
          const rejectForAbort = () => reject(new Error('ChatGPT sign in was cancelled.'));

          if (signal?.aborted) {
            rejectForAbort();
            return;
          }

          signal?.addEventListener('abort', rejectForAbort, { once: true });
        });
      }

      throw new Error('This version of Pi requested an unsupported sign-in step.');
    }
  };
}

async function loginWithPiModelRuntime({
  ModelRuntime,
  authPath,
  openExternal,
  providerId
}) {
  const modelRuntime = await ModelRuntime.create({
    allowModelNetwork: false,
    authPath,
    modelsPath: null
  });

  await modelRuntime.login(
    providerId,
    'oauth',
    createBrowserLoginInteraction({ openExternal })
  );
}

module.exports = {
  createBrowserLoginInteraction,
  isAllowedAuthenticationUrl,
  loginWithPiModelRuntime
};
