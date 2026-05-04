import {
  isCapacitor,
  openInCapacitorBrowser,
  registerCapacitorAuthListener,
} from '@affine/core/components/affine/auth/capacitor-oauth';
import { AffineContext } from '@affine/core/components/context';
import { AppContainer } from '@affine/core/desktop/components/app-container';
import { router } from '@affine/core/desktop/router';
import { configureCommonModules } from '@affine/core/modules';
import { AuthService, DefaultServerService } from '@affine/core/modules/cloud';
import { I18nProvider } from '@affine/core/modules/i18n';
import { LifecycleService } from '@affine/core/modules/lifecycle';
import {
  configureLocalStorageStateStorageImpls,
  NbstoreProvider,
} from '@affine/core/modules/storage';
import { PopupWindowProvider } from '@affine/core/modules/url';
import { configureBrowserWorkbenchModule } from '@affine/core/modules/workbench';
import { configureBrowserWorkspaceFlavours } from '@affine/core/modules/workspace-engine';
import createEmotionCache from '@affine/core/utils/create-emotion-cache';
import { getWorkerUrl } from '@affine/env/worker';
import { StoreManagerClient } from '@affine/nbstore/worker/client';
import { setTelemetryTransport } from '@affine/track';
import { CacheProvider } from '@emotion/react';
import { Framework, FrameworkRoot, getCurrentStore } from '@toeverything/infra';
import { OpClient } from '@toeverything/infra/op';
import { Suspense } from 'react';
import { RouterProvider } from 'react-router-dom';

const cache = createEmotionCache();

let storeManagerClient: StoreManagerClient;

const workerUrl = getWorkerUrl('nbstore');

if (
  window.SharedWorker &&
  localStorage.getItem('disableSharedWorker') !== 'true'
) {
  const worker = new SharedWorker(workerUrl, {
    name: 'affine-shared-worker',
  });
  storeManagerClient = new StoreManagerClient(new OpClient(worker.port));
} else {
  const worker = new Worker(workerUrl);
  storeManagerClient = new StoreManagerClient(new OpClient(worker));
}
setTelemetryTransport(storeManagerClient.telemetry);
window.addEventListener('beforeunload', () => {
  storeManagerClient.dispose();
});
window.addEventListener('focus', () => {
  storeManagerClient.resume();
});
window.addEventListener('click', () => {
  storeManagerClient.resume();
});
window.addEventListener('blur', () => {
  storeManagerClient.pause();
});

const future = {
  v7_startTransition: true,
} as const;

const framework = new Framework();
configureCommonModules(framework);
configureBrowserWorkbenchModule(framework);
configureLocalStorageStateStorageImpls(framework);
configureBrowserWorkspaceFlavours(framework);
framework.impl(NbstoreProvider, {
  openStore(key, options) {
    return storeManagerClient.open(key, options);
  },
});
framework.impl(PopupWindowProvider, {
  open: (target: string) => {
    // MOJO: when running inside the native shell, push popups through
    // SFSafariViewController so we don't trigger WKWebView's "open in
    // Safari" fallback (which kicks the user out of the app).
    if (isCapacitor()) {
      openInCapacitorBrowser(target).catch(error => {
        console.error('[mojo auth] failed to open capacitor browser', error);
      });
      return;
    }
    const targetUrl = new URL(target);

    let url: string;
    // safe to open directly if in the same origin
    if (targetUrl.origin === location.origin) {
      url = target;
    } else {
      const redirectProxy = location.origin + '/redirect-proxy';
      const search = new URLSearchParams({
        redirect_uri: target,
      });

      url = `${redirectProxy}?${search.toString()}`;
    }
    window.open(url, '_blank', 'popup noreferrer noopener');
  },
});
const frameworkProvider = framework.provider();

// MOJO: handle the OAuth callback that comes back through the native
// shell as `mojonotion://authentication?...`. The Safari sheet
// completes the Google flow, hops to our custom scheme, and Capacitor
// surfaces the URL here so we can finish auth in the WebView and let
// the cookie land in the right cookie jar.
if (isCapacitor()) {
  registerCapacitorAuthListener(({ method, payload }) => {
    const authService = frameworkProvider
      .get(DefaultServerService)
      .server.scope.get(AuthService);

    const finalize = (promise: Promise<unknown>) => {
      promise
        .then(() => {
          // The new session cookie lives on the WebView; reload so the
          // app re-bootstraps as the signed-in user.
          location.replace('/');
        })
        .catch(error => {
          console.error('[mojo auth] failed to finish sign-in', error);
        });
    };

    if (method === 'oauth' && payload.code && payload.state) {
      finalize(
        authService.signInOauth(
          payload.code,
          payload.state,
          payload.provider ?? ''
        )
      );
    } else if (method === 'magic-link' && payload.email && payload.token) {
      finalize(authService.signInMagicLink(payload.email, payload.token));
    }
  }).catch(error => {
    console.error('[mojo auth] failed to register listener', error);
  });
}

// setup application lifecycle events, and emit application start event
window.addEventListener('focus', () => {
  frameworkProvider.get(LifecycleService).applicationFocus();
});
frameworkProvider.get(LifecycleService).applicationStart();

export function App() {
  return (
    <Suspense>
      <FrameworkRoot framework={frameworkProvider}>
        <CacheProvider value={cache}>
          <I18nProvider>
            <AffineContext store={getCurrentStore()}>
              <RouterProvider
                fallbackElement={<AppContainer fallback />}
                router={router}
                future={future}
              />
            </AffineContext>
          </I18nProvider>
        </CacheProvider>
      </FrameworkRoot>
    </Suspense>
  );
}
