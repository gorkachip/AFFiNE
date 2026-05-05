import { MenuLinkItem } from '@affine/core/modules/app-sidebar/views';
import { AuthService } from '@affine/core/modules/cloud';
import { DeadlineIndexService } from '@affine/core/modules/deadline';
import { GlobalContextService } from '@affine/core/modules/global-context';
import { DateTimeIcon } from '@blocksuite/icons/rc';
import { useLiveData, useService } from '@toeverything/infra';
import { useMemo, useState } from 'react';

export const DeadlinesButton = () => {
  const globalContextService = useService(GlobalContextService);
  const deadlinesActive = useLiveData(
    globalContextService.globalContext.docId.$.map(id => id === null)
  );
  const authService = useService(AuthService);
  const deadlineIndex = useService(DeadlineIndexService);

  const currentUserId = useLiveData(
    authService.session.account$.map(a => a?.id ?? null)
  );
  const all = useLiveData(deadlineIndex.deadlines$);
  // Snapshot "now" at mount — the badge doesn't need sub-minute
  // precision and sampling Date.now in render trips purity lint.
  const [nowSnapshot] = useState(() => Date.now());
  const count = useMemo(() => {
    if (!currentUserId) return 0;
    return all.filter(entry => {
      // MOJO: badge counts only outstanding work — done deadlines drop
      // out, snoozed/active ones stay until their effective date passes.
      if (entry.done) return false;
      const effective = DeadlineIndexService.effectiveDeadline(entry);
      if (effective < nowSnapshot) return false;
      return (
        entry.createdBy === currentUserId ||
        entry.memberIds.includes(currentUserId)
      );
    }).length;
  }, [all, currentUserId, nowSnapshot]);

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
