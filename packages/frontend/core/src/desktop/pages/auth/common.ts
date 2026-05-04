import { z } from 'zod';

export const supportedClient = z.enum([
  'web',
  'affine',
  'affine-canary',
  'affine-beta',
  // MOJO: native iOS/Android shells identify themselves with this client
  // string when starting OAuth, so the callback page knows to bounce
  // through `mojonotion://` instead of staying in the Safari sheet.
  'mojonotion',
  ...(BUILD_CONFIG.debug ? ['affine-dev'] : []),
]);
