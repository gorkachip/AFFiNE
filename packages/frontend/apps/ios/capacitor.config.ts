import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { CapacitorConfig } from '@capacitor/cli';
import { KeyboardResize } from '@capacitor/keyboard';

const packageJson = JSON.parse(
  readFileSync(resolve(__dirname, './package.json'), 'utf-8')
);

interface AppConfig {
  affineVersion: string;
}

const config: CapacitorConfig & AppConfig = {
  // MOJO branded mobile shell — points at the self-hosted MOJO Notion
  // backend so all features deployed to the web automatically appear
  // in the app without rebuilding.
  appId: 'com.mojodevelopments.notion',
  appName: 'MOJO Notion',
  webDir: 'dist',
  affineVersion: packageJson.version,
  ios: {
    scheme: 'MOJO Notion',
    path: '.',
    webContentsDebuggingEnabled: true,
  },
  server: {
    url: 'https://notion.mojodevelopments.com',
    cleartext: false,
  },
  plugins: {
    // Bridge WKWebView's in-process cookie store with the system
    // HTTPCookieStorage so the auth session survives WebView process
    // restarts (iOS reclaims memory aggressively when the app is in
    // background and the user otherwise has to sign in on every launch).
    CapacitorCookies: {
      enabled: true,
    },
    CapacitorHttp: {
      enabled: false,
    },
    Keyboard: {
      resize: KeyboardResize.None,
    },
  },
};

if (process.env.CAP_SERVER_URL) {
  Object.assign(config, {
    server: {
      url: process.env.CAP_SERVER_URL,
    },
  });
}

export default config;
