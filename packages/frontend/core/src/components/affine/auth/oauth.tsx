import { Button } from '@affine/component/ui/button';
import { notify } from '@affine/component/ui/notification';
import { useAsyncCallback } from '@affine/core/components/hooks/affine-async-hooks';
import { AuthService, ServerService } from '@affine/core/modules/cloud';
import { UrlService } from '@affine/core/modules/url';
import { UserFriendlyError } from '@affine/error';
import { OAuthProviderType } from '@affine/graphql';
import track from '@affine/track';
import {
  AppleIcon,
  GithubIcon,
  GoogleIcon,
  LockIcon,
} from '@blocksuite/icons/rc';
import { useLiveData, useService } from '@toeverything/infra';
import { type ReactElement, type SVGAttributes, useCallback } from 'react';

import {
  isCapacitor,
  MOJO_NATIVE_CLIENT,
  openInCapacitorBrowser,
} from './capacitor-oauth';

const OAuthProviderMap: Record<
  OAuthProviderType,
  {
    icon: ReactElement<SVGAttributes<SVGElement>>;
  }
> = {
  [OAuthProviderType.Google]: {
    icon: <GoogleIcon />,
  },

  [OAuthProviderType.GitHub]: {
    icon: <GithubIcon />,
  },

  [OAuthProviderType.OIDC]: {
    icon: <LockIcon />,
  },

  [OAuthProviderType.Apple]: {
    icon: <AppleIcon />,
  },
};

export function OAuth({ redirectUrl }: { redirectUrl?: string }) {
  const serverService = useService(ServerService);
  const urlService = useService(UrlService);
  const oauth = useLiveData(serverService.server.features$.map(r => r?.oauth));
  const oauthProviders = useLiveData(
    serverService.server.config$.map(r => r?.oauthProviders)
  );
  const auth = useService(AuthService);

  const onContinue = useAsyncCallback(
    async (provider: OAuthProviderType) => {
      track.$.$.auth.signIn({ method: 'oauth', provider });

      // MOJO: when the deployed web bundle is running inside our native
      // Capacitor shell, Google OAuth in the WKWebView is rejected
      // ("Access blocked: app's request does not comply with Google's
      // policies"). Detect Capacitor at runtime and route OAuth through
      // the in-app Safari sheet (SFSafariViewController) instead.
      const useCapacitorOAuth = isCapacitor();

      const open: () => Promise<void> | void =
        BUILD_CONFIG.isNative || useCapacitorOAuth
          ? async () => {
              try {
                const scheme = useCapacitorOAuth
                  ? MOJO_NATIVE_CLIENT
                  : (urlService.getClientScheme() ?? 'web');
                const options = await auth.oauthPreflight(provider, scheme);
                if (useCapacitorOAuth) {
                  // Route through the native Browser plugin so the URL
                  // never touches the WKWebView (Google would block it).
                  // The callback returns to the app via the
                  // `mojonotion://` scheme handled in the appUrlOpen
                  // listener.
                  const opened = await openInCapacitorBrowser(options.url);
                  if (!opened) {
                    urlService.openPopupWindow(options.url);
                  }
                } else {
                  urlService.openPopupWindow(options.url);
                }
              } catch (e) {
                notify.error(UserFriendlyError.fromAny(e));
              }
            }
          : () => {
              const params = new URLSearchParams();

              params.set('provider', provider);

              if (redirectUrl) {
                params.set('redirect_uri', redirectUrl);
              }

              params.set('flow', 'redirect');

              const oauthUrl =
                serverService.server.baseUrl +
                `/oauth/login?${params.toString()}`;

              urlService.openExternal(oauthUrl);
            };

      const ret = open();

      if (ret instanceof Promise) {
        await ret;
      }
    },
    [urlService, redirectUrl, serverService, auth]
  );

  if (!oauth) {
    return null;
  }

  return oauthProviders?.map(provider => {
    return (
      <OAuthProvider
        key={provider}
        provider={provider}
        onContinue={onContinue}
      />
    );
  });
}

interface OauthProviderProps {
  provider: OAuthProviderType;
  onContinue: (provider: OAuthProviderType) => void;
}

function OAuthProvider({ onContinue, provider }: OauthProviderProps) {
  const { icon } =
    provider in OAuthProviderMap
      ? OAuthProviderMap[provider]
      : { icon: undefined };

  const onClick = useCallback(() => {
    onContinue(provider);
  }, [onContinue, provider]);

  return (
    <Button
      variant={provider === OAuthProviderType.Apple ? 'custom' : 'primary'}
      block
      size="extraLarge"
      style={{ width: '100%' }}
      prefix={icon}
      onClick={onClick}
    >
      Continue with {provider}
    </Button>
  );
}
