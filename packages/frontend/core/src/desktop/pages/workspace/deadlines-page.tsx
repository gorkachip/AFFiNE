import { Header } from '@affine/core/components/pure/header';
import { AuthService } from '@affine/core/modules/cloud';
import {
  type DeadlineEntry,
  DeadlineIndexService,
} from '@affine/core/modules/deadline';
import { WorkspacePermissionService } from '@affine/core/modules/permissions';
import { WorkbenchService } from '@affine/core/modules/workbench';
import { DateTimeIcon } from '@blocksuite/icons/rc';
import { useLiveData, useService } from '@toeverything/infra';
import { useCallback, useMemo, useState } from 'react';

import {
  ViewBody,
  ViewHeader,
  ViewIcon,
  ViewTitle,
} from '../../../modules/workbench';
import * as styles from './deadlines-page.css';

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function bucketFor(deadline: number, todayStart: number): string {
  const day = 24 * 60 * 60 * 1000;
  const diff = startOfDay(deadline) - todayStart;
  if (diff < 0) return 'Overdue';
  if (diff === 0) return 'Today';
  if (diff === day) return 'Tomorrow';
  if (diff <= 7 * day) return 'This week';
  return 'Upcoming';
}

const BUCKET_ORDER = [
  'Overdue',
  'Today',
  'Tomorrow',
  'This week',
  'Upcoming',
] as const;

export const DeadlinesPage = () => {
  const deadlineIndex = useService(DeadlineIndexService);
  const authService = useService(AuthService);
  const permissionService = useService(WorkspacePermissionService);
  const workbench = useService(WorkbenchService).workbench;

  const all = useLiveData(deadlineIndex.deadlines$);
  const currentUserId = useLiveData(
    authService.session.account$.map(a => a?.id ?? null)
  );
  const isOwnerOrAdmin = useLiveData(
    permissionService.permission.isOwnerOrAdmin$
  );

  // Snapshot "now" at mount — the page re-renders often enough (on data
  // changes) that a stale reading here is harmless, and sampling Date.now
  // inside render would trip the react-hooks/purity rule.
  const [nowSnapshot] = useState(() => Date.now());

  const visible = useMemo(() => {
    if (isOwnerOrAdmin) {
      return all.filter(entry => entry.deadline >= nowSnapshot);
    }
    if (!currentUserId) return [];
    return all.filter(
      entry =>
        entry.deadline >= nowSnapshot &&
        (entry.createdBy === currentUserId ||
          entry.memberIds.includes(currentUserId))
    );
  }, [all, currentUserId, isOwnerOrAdmin, nowSnapshot]);

  const grouped = useMemo(() => {
    const todayStart = startOfDay(nowSnapshot);
    const buckets: Record<string, DeadlineEntry[]> = {
      Overdue: [],
      Today: [],
      Tomorrow: [],
      'This week': [],
      Upcoming: [],
    };
    for (const entry of visible) {
      const key = bucketFor(entry.deadline, todayStart);
      buckets[key]?.push(entry);
    }
    for (const key of Object.keys(buckets)) {
      buckets[key].sort((a, b) => a.deadline - b.deadline);
    }
    return buckets;
  }, [visible, nowSnapshot]);

  const handleOpen = useCallback(
    (entry: DeadlineEntry) => {
      // Navigate to the doc that contains the card. BlockSuite will render
      // the kanban inside; the user can scroll to the specific row from
      // there.
      workbench.openDoc(entry.docId, { at: 'active' });
    },
    [workbench]
  );

  const isEmpty = visible.length === 0;

  return (
    <>
      <ViewTitle title="Deadlines" />
      <ViewIcon icon="journal" />
      <ViewHeader>
        <Header
          left={
            <div className={styles.title}>
              <DateTimeIcon className={styles.titleIcon} />
              Deadlines
            </div>
          }
        />
      </ViewHeader>
      <ViewBody>
        <div className={styles.body}>
          {isEmpty && (
            <div className={styles.empty}>No deadlines assigned to you.</div>
          )}
          {!isEmpty &&
            BUCKET_ORDER.map(bucket => {
              const items = grouped[bucket];
              if (!items || items.length === 0) return null;
              return (
                <section key={bucket} className={styles.bucket}>
                  <h3 className={styles.bucketHeader}>
                    {bucket}
                    <span className={styles.bucketCount}>{items.length}</span>
                  </h3>
                  <ul className={styles.list}>
                    {items.map(entry => (
                      <li
                        key={entry.id}
                        className={styles.row}
                        onClick={() => handleOpen(entry)}
                      >
                        <span className={styles.cardTitle}>
                          {entry.title || 'Untitled card'}
                        </span>
                        <span className={styles.cardDate}>
                          {new Date(entry.deadline).toLocaleDateString()}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
        </div>
      </ViewBody>
    </>
  );
};

export const Component = () => <DeadlinesPage />;
