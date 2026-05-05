// MOJO: bridge between the deployed web bundle and the native Capacitor
// shells (iOS / Android) for OAuth. The web bundle is loaded via
// `server.url`, so it does NOT import `@capacitor/*` at build time —
// instead we talk to the natively-registered plugins through the
// `window.Capacitor.Plugins` global that the runtime injects.

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  Plugins?: {
    Browser?: {
      open: (options: {
        url: string;
        presentationStyle?: 'fullscreen' | 'popover';
      }) => Promise<void>;
      close: () => Promise<void>;
    };
    App?: {
      addListener: (
        event: 'appUrlOpen',
        listener: (data: { url: string }) => void
      ) => Promise<{ remove: () => Promise<void> }>;
      getLaunchUrl?: () => Promise<{ url?: string } | null>;
    };
    // MOJO: native plugin (App/MojoOAuthPlugin.swift) wrapping
    // ASWebAuthenticationSession so OAuth can return to the app
    // through a custom URL scheme — SFSafariViewController silently
    // drops `mojonotion://` since iOS 14 and breaks the callback.
    MojoOAuth?: {
      startAuthSession: (options: {
        url: string;
        callbackScheme: string;
      }) => Promise<{ url: string }>;
    };
  };
}

function getCapacitor(): CapacitorGlobal | undefined {
  return (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;
}

export function isCapacitor(): boolean {
  const cap = getCapacitor();
  return !!cap?.isNativePlatform?.();
}

export const MOJO_NATIVE_CLIENT = 'mojonotion';

export async function openInCapacitorBrowser(url: string): Promise<boolean> {
  const browser = getCapacitor()?.Plugins?.Browser;
  if (!browser) {
    return false;
  }
  await browser.open({ url, presentationStyle: 'popover' });
  return true;
}

/**
 * MOJO: starts an `ASWebAuthenticationSession` via the native plugin
 * and resolves with the callback URL that closes it. SFSafariViewController
 * (used by `@capacitor/browser`) blocks navigation to custom schemes
 * since iOS 14, so the OAuth flow has to go through this instead.
 *
 * Returns `null` when the plugin isn't available (web bundle running
 * outside the native shell), so callers can fall back to the legacy
 * `Browser.open` path.
 */
export async function startCapacitorOAuthSession(
  url: string
): Promise<string | null> {
  const plugin = getCapacitor()?.Plugins?.MojoOAuth;
  if (!plugin) return null;
  const result = await plugin.startAuthSession({
    url,
    callbackScheme: MOJO_NATIVE_CLIENT,
  });
  return result.url;
}

export async function closeCapacitorBrowser(): Promise<void> {
  const browser = getCapacitor()?.Plugins?.Browser;
  if (!browser) {
    return;
  }
  try {
    await browser.close();
  } catch {
    // Browser may already be closed; ignore.
  }
}

export interface CapacitorAuthPayload {
  method: 'oauth' | 'magic-link';
  payload: {
    code?: string;
    state?: string;
    provider?: string;
    email?: string;
    token?: string;
  };
  server?: string;
}

export function parseCapacitorAuthUrl(
  rawUrl: string
): CapacitorAuthPayload | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== `${MOJO_NATIVE_CLIENT}:`) return null;
  if (url.hostname !== 'authentication') return null;

  const method = url.searchParams.get('method');
  if (method !== 'oauth' && method !== 'magic-link') return null;

  const payloadRaw = url.searchParams.get('payload');
  if (!payloadRaw) return null;

  let payload: CapacitorAuthPayload['payload'];
  try {
    payload = JSON.parse(payloadRaw);
  } catch {
    return null;
  }
  return {
    method,
    payload,
    server: url.searchParams.get('server') ?? undefined,
  };
}

export async function registerCapacitorAuthListener(
  handler: (data: CapacitorAuthPayload) => void
): Promise<{ remove: () => Promise<void> } | null> {
  const app = getCapacitor()?.Plugins?.App;
  if (!app) return null;

  const swallow = (label: string) => (error: unknown) => {
    console.error(`[mojo auth] ${label}`, error);
  };

  const listener = await app.addListener('appUrlOpen', ({ url }) => {
    const parsed = parseCapacitorAuthUrl(url);
    if (parsed) {
      // Dismiss the Safari sheet that initiated the OAuth flow before
      // running the auth call so the user lands back on the app UI.
      closeCapacitorBrowser().catch(swallow('close browser'));
      handler(parsed);
    }
  });

  // Cold-launch case: the URL that woke the app may have arrived
  // before our listener was registered.
  try {
    const launch = await app.getLaunchUrl?.();
    if (launch?.url) {
      const parsed = parseCapacitorAuthUrl(launch.url);
      if (parsed) {
        closeCapacitorBrowser().catch(swallow('close browser'));
        handler(parsed);
      }
    }
  } catch {
    // ignore
  }

  return listener;
}
