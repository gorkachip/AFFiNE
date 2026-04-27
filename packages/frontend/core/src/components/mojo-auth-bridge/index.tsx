import { notify } from '@affine/component';
import { AuthService } from '@affine/core/modules/cloud';
import { WorkspacePermissionService } from '@affine/core/modules/permissions';
import { useLiveData, useService } from '@toeverything/infra';
import { useEffect } from 'react';

import { CardActivityModalListener } from './card-activity-modal';

/**
 * MOJO bridge: keep a tiny global with the current user id and
 * workspace owner/admin flag so low-level entities (DocRecord) can
 * enforce delete permissions without importing service modules and
 * without circular deps. Mount this once near the workspace root.
 */
export const MojoAuthBridge = () => {
  const authService = useService(AuthService);
  const permissionService = useService(WorkspacePermissionService);

  const userId = useLiveData(
    authService.session.account$.map(a => a?.id ?? null)
  );
  const isOwnerOrAdmin = useLiveData(
    permissionService.permission.isOwnerOrAdmin$
  );

  useEffect(() => {
    (globalThis as any).__mojoAuthContext = {
      userId,
      isOwnerOrAdmin: !!isOwnerOrAdmin,
    };
    return () => {
      // Clear on unmount so leaked contexts from a previous workspace
      // don't authorise actions in a subsequent one.
      delete (globalThis as any).__mojoAuthContext;
    };
  }, [userId, isOwnerOrAdmin]);

  // Surface gate-blocked actions (silent framework deletes, kanban
  // row/column/view delete throws, etc.) as a user-visible toast. The
  // dispatcher can pass a specific message via event.detail.message so
  // we can show "Only the column creator..." vs "Only the card
  // creator..." instead of one generic text. Throttled to one toast per
  // second so a backspace-spam doesn't flood the screen with duplicates.
  useEffect(() => {
    let last = 0;
    const handler = (event: Event) => {
      const now = Date.now();
      if (now - last < 1000) return;
      last = now;
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      notify.error({
        title: 'Cannot delete',
        message:
          detail?.message ||
          'Only the creator or a workspace admin can delete this item. Ask an admin if you need it gone.',
      });
    };
    document.addEventListener('mojo-delete-blocked', handler);
    return () => document.removeEventListener('mojo-delete-blocked', handler);
  }, []);

  return <CardActivityModalListener />;
};
