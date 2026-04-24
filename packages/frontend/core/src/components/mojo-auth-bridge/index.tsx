import { AuthService } from '@affine/core/modules/cloud';
import { WorkspacePermissionService } from '@affine/core/modules/permissions';
import { useLiveData, useService } from '@toeverything/infra';
import { useEffect } from 'react';

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

  return null;
};
