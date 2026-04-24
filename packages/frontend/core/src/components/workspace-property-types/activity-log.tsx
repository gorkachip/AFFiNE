import { Menu, PropertyValue, Tooltip } from '@affine/component';
import { DocService } from '@affine/core/modules/doc';
import { CommentIcon } from '@blocksuite/icons/rc';
import { useLiveData, useService } from '@toeverything/infra';
import { useMemo, useState } from 'react';

import { PlainTextDocGroupHeader } from '../explorer/docs-view/group-header';
import { StackProperty } from '../explorer/docs-view/stack-property';
import type { DocListPropertyProps, GroupHeaderProps } from '../explorer/types';
import type { PropertyValueProps } from '../properties/types';
import * as styles from './activity-log.css';
import {
  type ActivityLogDocContext,
  formatRelativeTime,
  parseValue,
  useActivityLogPanel,
} from './activity-log-shared';

export const ActivityLogValueRenderer = ({
  value,
  onChange,
  readonly,
}: PropertyValueProps) => {
  const [open, setOpen] = useState(false);
  const docService = useService(DocService);
  const docTitle = useLiveData(docService.doc.record.title$);
  const docMode = useLiveData(docService.doc.record.primaryMode$);
  const docContext = useMemo<ActivityLogDocContext>(
    () => ({
      id: docService.doc.id,
      title: docTitle || 'Untitled',
      mode: docMode,
    }),
    [docService.doc.id, docTitle, docMode]
  );
  const { entryCount, triggerSnippet, popoverBody } = useActivityLogPanel(
    value,
    onChange,
    readonly,
    docContext
  );

  return (
    <PropertyValue
      className={styles.triggerContainer}
      isEmpty={entryCount === 0}
      readonly={readonly}
      onClick={() => setOpen(true)}
    >
      <CommentIcon />
      <span className={styles.triggerCount}>{entryCount}</span>
      <span className={styles.triggerSnippet}>{triggerSnippet}</span>
      <Menu
        rootOptions={{ open, onOpenChange: setOpen, modal: true }}
        contentOptions={{
          sideOffset: 4,
          align: 'start',
          className: styles.popoverRoot,
        }}
        items={popoverBody}
      >
        <span className={styles.menuAnchor} aria-hidden />
      </Menu>
    </PropertyValue>
  );
};

export const ActivityLogDocListProperty = ({ value }: DocListPropertyProps) => {
  const parsed = parseValue(value);
  const count = parsed.entries.reduce(
    (a, e) => a + 1 + (e.replies?.length ?? 0),
    0
  );
  const last = parsed.entries[parsed.entries.length - 1];
  const lastLabel = last
    ? `${count} · ${formatRelativeTime(last.timestamp)}`
    : '0';
  const previewEntries = parsed.entries.slice(-3).reverse();

  if (count === 0) {
    return (
      <StackProperty icon={<CommentIcon />}>
        <span className={styles.docListContainer}>—</span>
      </StackProperty>
    );
  }

  return (
    <Tooltip
      side="top"
      content={
        <div className={styles.previewTooltip}>
          {previewEntries.map(e => (
            <div className={styles.previewEntry} key={e.id}>
              <div className={styles.previewHead}>
                <span className={styles.previewAuthor}>{e.authorName}</span>
                <span className={styles.previewTime}>
                  {formatRelativeTime(e.timestamp)}
                </span>
              </div>
              <div className={styles.previewBody}>
                {e.text.length > 120 ? `${e.text.slice(0, 120)}…` : e.text}
              </div>
            </div>
          ))}
        </div>
      }
    >
      <StackProperty icon={<CommentIcon />}>
        <span className={styles.docListContainer}>{lastLabel}</span>
      </StackProperty>
    </Tooltip>
  );
};

export const ActivityLogGroupHeader = ({
  groupId,
  docCount,
}: GroupHeaderProps) => {
  return (
    <PlainTextDocGroupHeader docCount={docCount} groupId={groupId}>
      {groupId === 'has-entries' ? 'Has activity' : 'No activity'}
    </PlainTextDocGroupHeader>
  );
};
