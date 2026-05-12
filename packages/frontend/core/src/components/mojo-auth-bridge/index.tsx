import { notify } from '@affine/component';
import { AuthService } from '@affine/core/modules/cloud';
import { OrganizeService } from '@affine/core/modules/organize';
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
  const organizeService = useService(OrganizeService);

  const userId = useLiveData(
    authService.session.account$.map(a => a?.id ?? null)
  );
  // MOJO: prefer the display name, but fall back to email (or its
  // local-part) so the activity log says "ari@mojo did X" instead of
  // "Someone did X" for users that never set a profile name.
  const userName = useLiveData(
    authService.session.account$.map(a => {
      if (!a) return null;
      const label = a.label?.trim();
      if (label) return label;
      const email = a.email?.trim();
      if (!email) return null;
      const at = email.indexOf('@');
      return at > 0 ? email.slice(0, at) : email;
    })
  );
  const isOwnerOrAdmin = useLiveData(
    permissionService.permission.isOwnerOrAdmin$
  );

  useEffect(() => {
    (globalThis as any).__mojoAuthContext = {
      userId,
      userName,
      isOwnerOrAdmin: !!isOwnerOrAdmin,
    };
    return () => {
      // Clear on unmount so leaked contexts from a previous workspace
      // don't authorise actions in a subsequent one.
      delete (globalThis as any).__mojoAuthContext;
    };
  }, [userId, userName, isOwnerOrAdmin]);

  // MOJO: install a synchronous lock checker so low-level entities
  // (DocRecord.moveToTrash, DocsService.changeDocTitle, etc.) can
  // refuse mutations on docs that live inside a locked folder
  // without having to import OrganizeService themselves.
  useEffect(() => {
    (globalThis as any).__mojoFolderLockChecker = {
      isDocLocked: (docId: string): boolean => {
        try {
          return (
            organizeService.folderTree.lockForDoc$(docId).value !== null
          );
        } catch {
          return false;
        }
      },
    };
    return () => {
      delete (globalThis as any).__mojoFolderLockChecker;
    };
  }, [organizeService]);

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
