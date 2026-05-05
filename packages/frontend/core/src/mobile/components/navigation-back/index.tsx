import {
  IconButton,
  type IconButtonProps,
  useIsInsideModal,
} from '@affine/component';
import { ArrowLeftSmallIcon, CloseIcon } from '@blocksuite/icons/rc';
import { useService } from '@toeverything/infra';
import { useCallback, useEffect, useMemo } from 'react';

import { WorkbenchService } from '../../../modules/workbench';
import { NavigationGestureService } from '../../modules/navigation-gesture';

export interface NavigationBackButtonProps extends IconButtonProps {
  backAction?: () => void;
}

/**
 * A button to control the back behavior of the mobile app, as well as manage navigation gesture
 */
export const NavigationBackButton = ({
  icon,
  backAction,
  children,
  style: propsStyle,
  ...otherProps
}: NavigationBackButtonProps) => {
  const navigationGesture = useService(NavigationGestureService);
  const workbench = useService(WorkbenchService).workbench;
  const isInsideModal = useIsInsideModal();

  const handleRouteBack = useCallback(() => {
    if (backAction) {
      backAction();
      return;
    }
    // MOJO: window.history.back() does nothing here — the workbench
    // owns its own in-memory history (createNavigableHistory) and
    // window.history is essentially a single entry inside the
    // Capacitor WebView. Pop the workbench's active view stack
    // instead. Fall back to /all when there's nowhere to go (so the
    // button never silently no-ops).
    const view = workbench.activeView$.value;
    if (view && view.history.index > 0) {
      view.history.back();
    } else {
      workbench.openAll();
    }
  }, [backAction, workbench]);

  useEffect(() => {
    if (isInsideModal) return;

    const prev = navigationGesture.enabled$.value;
    navigationGesture.setEnabled(true);

    return () => {
      navigationGesture.setEnabled(prev);
    };
  }, [isInsideModal, navigationGesture]);

  const style = useMemo(() => ({ padding: 10, ...propsStyle }), [propsStyle]);

  if (children) return children;

  return (
    <IconButton
      size={24}
      style={style}
      onClick={handleRouteBack}
      icon={icon ?? (isInsideModal ? <CloseIcon /> : <ArrowLeftSmallIcon />)}
      data-testid="page-header-back"
      {...otherProps}
    />
  );
};
