import { MenuLinkItem } from '@affine/core/modules/app-sidebar/views';
import { AuthService } from '@affine/core/modules/cloud';
import { DeadlineIndexService } from '@affine/core/modules/deadline';
import { GlobalContextService } from '@affine/core/modules/global-context';
import { WorkspacePermissionService } from '@affine/core/modules/permissions';
import { DateTimeIcon } from '@blocksuite/icons/rc';
import { useLiveData, useService } from '@toeverything/infra';
import { useMemo, useState } from 'react';

export const DeadlinesButton = () => {
  const globalContextService = useService(GlobalContextService);
  const deadlinesActive = useLiveData(
    globalContextService.globalContext.docId.$.map(id => id === null)
  );
  const authService = useService(AuthService);
  const permissionService = useService(WorkspacePermissionService);
  const deadlineIndex = useService(DeadlineIndexService);

  const currentUserId = useLiveData(
    authService.session.account$.map(a => a?.id ?? null)
  );
  const isOwnerOrAdmin = useLiveData(
    permissionService.permission.isOwnerOrAdmin$
  );
  const all = useLiveData(deadlineIndex.deadlines$);
  // Snapshot "now" at mount — the badge doesn't need sub-minute
  // precision and sampling Date.now in render trips purity lint.
  const [nowSnapshot] = useState(() => Date.now());
  const count = useMemo(() => {
    return all.filter(entry => {
      if (entry.deadline < nowSnapshot) return false;
      if (isOwnerOrAdmin) return true;
      if (!currentUserId) return false;
      return (
        entry.createdBy === currentUserId ||
        entry.memberIds.includes(currentUserId)
      );
    }).length;
  }, [all, currentUserId, isOwnerOrAdmin, nowSnapshot]);

  return (
    <MenuLinkItem
      icon={<DateTimeIcon />}
      active={deadlinesActive}
      to="/deadlines"
    >
      <span data-testid="deadlines-page">
        Deadlines{count > 0 ? ` (${count})` : ''}
      </span>
    </MenuLinkItem>
  );
};
