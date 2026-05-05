import { MenuLinkItem } from '@affine/core/modules/app-sidebar/views';
import { AuthService } from '@affine/core/modules/cloud';
import {
  DeadlineIndexService,
  DeadlineUiStateService,
} from '@affine/core/modules/deadline';
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
  const uiState = useService(DeadlineUiStateService);

  const currentUserId = useLiveData(
    authService.session.account$.map(a => a?.id ?? null)
  );
  const all = useLiveData(deadlineIndex.deadlines$);
  const states = useLiveData(uiState.states$);
  // Snapshot "now" at mount — the badge doesn't need sub-minute
  // precision and sampling Date.now in render trips purity lint.
  const [nowSnapshot] = useState(() => Date.now());
  const count = useMemo(() => {
    if (!currentUserId) return 0;
    return all.filter(entry => {
      const local = states[entry.id];
      if (local?.done) return false;
      const effective =
        local?.snoozedUntil && local.snoozedUntil > entry.deadline
          ? local.snoozedUntil
          : entry.deadline;
      if (effective < nowSnapshot) return false;
      return (
        entry.createdBy === currentUserId ||
        entry.memberIds.includes(currentUserId)
      );
    }).length;
  }, [all, currentUserId, nowSnapshot, states]);

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
