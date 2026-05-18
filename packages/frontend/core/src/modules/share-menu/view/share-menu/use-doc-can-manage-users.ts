import { useGuard } from '@affine/core/components/guard';
import { OrganizeService } from '@affine/core/modules/organize';
import { WorkspacePermissionService } from '@affine/core/modules/permissions';
import { useLiveData, useService } from '@toeverything/infra';

// MOJO: Share-panel member management is gated on folder lock — when
// the doc lives inside a locked folder only workspace owners/admins
// may invite, remove, or re-role collaborators. Per-doc Manager grants
// (which normally grant Doc_Users_Manage) lose this ability under a
// lock. Reason: the lock is meant to freeze the collaborator set, not
// just the content.
export const useDocCanManageUsers = (docId: string) => {
  const canManageGuard = useGuard('Doc_Users_Manage', docId);
  const organizeService = useService(OrganizeService);
  const workspacePermissionService = useService(WorkspacePermissionService);
  const lock = useLiveData(organizeService.folderTree.lockForDoc$(docId));
  const isOwnerOrAdmin = useLiveData(
    workspacePermissionService.permission.isOwnerOrAdmin$
  );
  if (lock !== null && !isOwnerOrAdmin) return false;
  return canManageGuard;
};
