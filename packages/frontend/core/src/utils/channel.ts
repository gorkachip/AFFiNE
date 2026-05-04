import { z } from 'zod';

export const appSchemes = z.enum([
  'affine',
  'affine-canary',
  'affine-beta',
  'affine-internal',
  'affine-dev',
  // MOJO: native iOS/Android shells use this scheme so OAuth and other
  // deep links can hop from the in-app Safari sheet back into the app.
  'mojonotion',
]);

export type Scheme = z.infer<typeof appSchemes>;
export type Channel = 'stable' | 'canary' | 'beta' | 'internal';

export const schemeToChannel = {
  affine: 'stable',
  'affine-canary': 'canary',
  'affine-beta': 'beta',
  'affine-internal': 'internal',
  'affine-dev': 'canary', // dev does not have a dedicated app. use canary as the placeholder.
} as Record<Scheme, Channel>;

export const channelToScheme = {
  stable: 'affine',
  canary: BUILD_CONFIG.debug ? 'affine-dev' : 'affine-canary',
  beta: 'affine-beta',
  internal: 'affine-internal',
} as Record<Channel, Scheme>;

// MOJO: all channels use the same MOJO logo. We don't ship desktop app
// variants for the MOJO fork.
export const appIconMap = {
  stable: '/imgs/mojo-logo.png',
  canary: '/imgs/mojo-logo.png',
  beta: '/imgs/mojo-logo.png',
  internal: '/imgs/mojo-logo.png',
} satisfies Record<Channel, string>;

export const appNames = {
  stable: 'MOJO Notion',
  canary: 'MOJO Notion Canary',
  beta: 'MOJO Notion Beta',
  internal: 'MOJO Notion Internal',
} satisfies Record<Channel, string>;

export const appSchemaUrl = z.custom<string>(
  (url: string) => {
    try {
      return appSchemes.safeParse(new URL(url).protocol.replace(':', ''))
        .success;
    } catch {
      return false;
    }
  },
  { message: 'Invalid URL or protocol' }
);
