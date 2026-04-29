import { SafeArea, useThemeColorV2 } from '@affine/component';

import { AppTabs } from '../../components';
import {
  NavigationPanelCollections,
  NavigationPanelFavorites,
  NavigationPanelOrganize,
  NavigationPanelTags,
} from '../../components/navigation';
import { DeadlinesShortcut, HomeHeader, RecentDocs } from '../../views';

export const Component = () => {
  useThemeColorV2('layer/background/mobile/primary');

  return (
    <>
      <HomeHeader />
      <DeadlinesShortcut />
      <RecentDocs />
      <SafeArea bottom>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 32,
            padding: '0 8px 32px 8px',
          }}
        >
          <NavigationPanelFavorites />
          <NavigationPanelOrganize />
          <NavigationPanelCollections />
          <NavigationPanelTags />
        </div>
      </SafeArea>
      <AppTabs />
    </>
  );
};
