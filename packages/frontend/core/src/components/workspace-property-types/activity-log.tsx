import { Menu, PropertyValue, Tooltip } from '@affine/component';
import { AuthService } from '@affine/core/modules/cloud';
import { DocService } from '@affine/core/modules/doc';
import { NotificationService } from '@affine/core/modules/notification';
import { WorkspaceMembersService } from '@affine/core/modules/permissions';
import type { Member } from '@affine/core/modules/permissions/entities/members';
import { WorkspaceService } from '@affine/core/modules/workspace';
import {
  CommentIcon,
  DeleteIcon as TrashIcon,
  EditIcon,
} from '@blocksuite/icons/rc';
import { useLiveData, useService } from '@toeverything/infra';
import { nanoid } from 'nanoid';
import {
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { PlainTextDocGroupHeader } from '../explorer/docs-view/group-header';
import { StackProperty } from '../explorer/docs-view/stack-property';
import type { DocListPropertyProps, GroupHeaderProps } from '../explorer/types';
import type { PropertyValueProps } from '../properties/types';
import * as styles from './activity-log.css';

interface ActivityEntry {
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  timestamp: number;
  /** plain user ids that were @-mentioned in this entry */
  mentions: string[];
  /** flat replies to this entry (one level deep, AFFiNE comment-style) */
  replies?: ActivityEntry[];
  /** edited timestamp; undefined if never edited */
  editedAt?: number;
}

interface ActivityLogValue {
  entries: ActivityEntry[];
}

const EMPTY_VALUE: ActivityLogValue = { entries: [] };

function parseValue(raw: string | undefined): ActivityLogValue {
  if (!raw) return EMPTY_VALUE;
  try {
    const parsed = JSON.parse(raw) as Partial<ActivityLogValue>;
    return {
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    };
  } catch {
    return EMPTY_VALUE;
  }
}

function serializeValue(value: ActivityLogValue): string {
  return JSON.stringify(value);
}

function formatRelativeTime(ts: number): string {
  const diffMs = Date.now() - ts;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < minute) return 'just now';
  if (diffMs < hour) return `${Math.floor(diffMs / minute)}m ago`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)}h ago`;
  if (diffMs < 7 * day) return `${Math.floor(diffMs / day)}d ago`;
  return new Date(ts).toLocaleDateString();
}

function extractMentions(
  text: string,
  members: { id: string; name?: string | null; email?: string | null }[]
): string[] {
  // very small parser: @<token> where token is alphanum / dot / dash / underscore
  const tokens = new Set<string>();
  const re = /@([\w.-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const handle = m[1].toLowerCase();
    const member = members.find(mb => {
      const name = (mb.name ?? '').toLowerCase();
      const emailLocal = (mb.email ?? '').split('@')[0].toLowerCase();
      return name === handle || emailLocal === handle;
    });
    if (member) tokens.add(member.id);
  }
  return Array.from(tokens);
}

function renderTextWithMentions(
  text: string,
  members: { id: string; name?: string | null; email?: string | null }[]
): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(@[\w.-]+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      out.push(text.slice(lastIndex, match.index));
    }
    const handle = match[1].slice(1).toLowerCase();
    const member = members.find(mb => {
      const name = (mb.name ?? '').toLowerCase();
      const emailLocal = (mb.email ?? '').split('@')[0].toLowerCase();
      return name === handle || emailLocal === handle;
    });
    if (member) {
      out.push(
        <span className={styles.mentionToken} key={`m${i++}`}>
          @{member.name ?? member.email ?? handle}
        </span>
      );
    } else {
      out.push(match[1]);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    out.push(text.slice(lastIndex));
  }
  return out;
}

export const ActivityLogValueRenderer = ({
  value,
  onChange,
  readonly,
}: PropertyValueProps) => {
  const authService = useService(AuthService);
  const membersService = useService(WorkspaceMembersService);
  const docService = useService(DocService);
  const workspaceService = useService(WorkspaceService);
  const notificationService = useService(NotificationService);
  const account = useLiveData(authService.session.account$);
  const rawMembers = useLiveData(membersService.members.pageMembers$);
  const members = useMemo<Member[]>(() => rawMembers ?? [], [rawMembers]);
  const docTitle = useLiveData(docService.doc.record.title$);
  const docMode = useLiveData(docService.doc.record.primaryMode$);
  const isCloud = workspaceService.workspace.flavour !== 'local';

  const notifyMentions = useCallback(
    (recipients: string[]) => {
      if (!isCloud || !account) return;
      const workspaceId = workspaceService.workspace.id;
      const doc = {
        id: docService.doc.id,
        title: docTitle || 'Untitled',
        mode: docMode,
      };
      for (const userId of recipients) {
        if (userId === account.id) continue;
        notificationService.mentionUser(userId, workspaceId, doc).catch(() => {
          // silently ignore (self-mention denial, no read access, etc)
        });
      }
    },
    [
      isCloud,
      account,
      workspaceService,
      docService,
      docTitle,
      docMode,
      notificationService,
    ]
  );

  useEffect(() => {
    membersService.members.setPageNum(0);
    membersService.members.revalidate();
  }, [membersService]);

  const parsed = useMemo(() => parseValue(value), [value]);

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [activeMentionIdx, setActiveMentionIdx] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const entryCount = useMemo(() => {
    return parsed.entries.reduce(
      (acc, e) => acc + 1 + (e.replies?.length ?? 0),
      0
    );
  }, [parsed.entries]);

  const lastEntry = parsed.entries[parsed.entries.length - 1];

  const triggerSnippet = lastEntry
    ? `${lastEntry.authorName}: ${lastEntry.text.slice(0, 60)}${lastEntry.text.length > 60 ? '…' : ''}`
    : 'No entries yet';

  const filteredMembers = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return members
      .filter((m: Member) => {
        const name = (m.name ?? '').toLowerCase();
        const email = (m.email ?? '').toLowerCase();
        return name.includes(q) || email.includes(q);
      })
      .slice(0, 8);
  }, [members, mentionQuery]);

  const insertMention = useCallback(
    (member: { id: string; name?: string | null; email?: string | null }) => {
      const handle =
        (member.name && member.name.replace(/\s+/g, '.').toLowerCase()) ||
        (member.email && member.email.split('@')[0]) ||
        member.id;
      // Replace the partial @query with the resolved handle
      setDraft(prev => {
        const re = /@([\w.-]*)$/;
        return prev.replace(re, `@${handle} `);
      });
      setMentionQuery(null);
      setActiveMentionIdx(0);
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    []
  );

  const onDraftChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    setDraft(next);
    // detect trailing @query for autocomplete
    const m = /@([\w.-]*)$/.exec(next);
    if (m) {
      setMentionQuery(m[1]);
      setActiveMentionIdx(0);
    } else {
      setMentionQuery(null);
    }
  }, []);

  const submit = useCallback(() => {
    if (!draft.trim() || !account) return;
    const mentions = extractMentions(draft, members);
    const entry: ActivityEntry = {
      id: nanoid(),
      authorId: account.id,
      authorName: account.label ?? account.email ?? account.id,
      text: draft.trim(),
      timestamp: Date.now(),
      mentions,
    };
    let next: ActivityLogValue;
    if (replyTo) {
      next = {
        entries: parsed.entries.map(e =>
          e.id === replyTo
            ? { ...e, replies: [...(e.replies ?? []), entry] }
            : e
        ),
      };
    } else {
      next = { entries: [...parsed.entries, entry] };
    }
    onChange(serializeValue(next));
    notifyMentions(mentions);
    setDraft('');
    setReplyTo(null);
    setMentionQuery(null);
  }, [
    draft,
    account,
    members,
    parsed.entries,
    replyTo,
    onChange,
    notifyMentions,
  ]);

  const onDraftKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (mentionQuery !== null && filteredMembers.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setActiveMentionIdx(i => (i + 1) % filteredMembers.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setActiveMentionIdx(
            i => (i - 1 + filteredMembers.length) % filteredMembers.length
          );
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          insertMention(filteredMembers[activeMentionIdx]);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setMentionQuery(null);
          return;
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
    },
    [mentionQuery, filteredMembers, activeMentionIdx, insertMention, submit]
  );

  const removeEntry = useCallback(
    (id: string) => {
      const next: ActivityLogValue = {
        entries: parsed.entries
          .filter(e => e.id !== id)
          .map(e => ({
            ...e,
            replies: e.replies?.filter(r => r.id !== id),
          })),
      };
      onChange(serializeValue(next));
    },
    [parsed.entries, onChange]
  );

  const startEdit = useCallback((entry: ActivityEntry) => {
    setEditingId(entry.id);
    setEditDraft(entry.text);
  }, []);

  const commitEdit = useCallback(() => {
    if (!editingId) return;
    const newMentions = extractMentions(editDraft, members);
    let prevMentions: string[] = [];
    const updated = (e: ActivityEntry): ActivityEntry => {
      if (e.id !== editingId) return e;
      prevMentions = e.mentions ?? [];
      return {
        ...e,
        text: editDraft.trim() || e.text,
        editedAt: Date.now(),
        mentions: newMentions,
      };
    };
    const next: ActivityLogValue = {
      entries: parsed.entries.map(e => ({
        ...updated(e),
        replies: e.replies?.map(updated),
      })),
    };
    onChange(serializeValue(next));
    // Only fire notifications for mentions that weren't already in the entry,
    // so re-saving doesn't spam users who were tagged from the start.
    const added = newMentions.filter(id => !prevMentions.includes(id));
    notifyMentions(added);
    setEditingId(null);
    setEditDraft('');
  }, [editingId, editDraft, members, parsed.entries, onChange, notifyMentions]);

  const renderEntry = (entry: ActivityEntry, isReply = false) => {
    const isOwn = entry.authorId === account?.id;
    const isEditing = entry.id === editingId;
    return (
      <div className={styles.entry} key={entry.id}>
        <div className={styles.entryHead}>
          <span className={styles.entryAuthor}>{entry.authorName}</span>
          <span className={styles.entryTime}>
            {formatRelativeTime(entry.timestamp)}
            {entry.editedAt ? ' · edited' : ''}
          </span>
          {!readonly && !isEditing && (
            <span className={styles.entryActions}>
              {!isReply && (
                <button
                  className={styles.entryActionButton}
                  onClick={() => {
                    setReplyTo(entry.id);
                    requestAnimationFrame(() => textareaRef.current?.focus());
                  }}
                >
                  Reply
                </button>
              )}
              {isOwn && (
                <>
                  <button
                    className={styles.entryActionButton}
                    onClick={() => startEdit(entry)}
                  >
                    <EditIcon />
                  </button>
                  <button
                    className={styles.entryActionButton}
                    onClick={() => removeEntry(entry.id)}
                  >
                    <TrashIcon />
                  </button>
                </>
              )}
            </span>
          )}
        </div>
        {isEditing ? (
          <>
            <textarea
              className={styles.textarea}
              value={editDraft}
              onChange={e => setEditDraft(e.target.value)}
              autoFocus
            />
            <div
              style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}
            >
              <button
                className={styles.entryActionButton}
                onClick={() => {
                  setEditingId(null);
                  setEditDraft('');
                }}
              >
                Cancel
              </button>
              <button className={styles.submitButton} onClick={commitEdit}>
                Save
              </button>
            </div>
          </>
        ) : (
          <div className={styles.entryBody}>
            {renderTextWithMentions(entry.text, members)}
          </div>
        )}
        {!isReply && entry.replies && entry.replies.length > 0 && (
          <div className={styles.replyList}>
            {entry.replies.map(r => renderEntry(r, true))}
          </div>
        )}
      </div>
    );
  };

  const popoverContent = (
    <>
      <div className={styles.entryList}>
        {parsed.entries.length === 0 ? (
          <div className={styles.emptyState}>
            No activity yet. Be the first to add an update.
          </div>
        ) : (
          parsed.entries.map(e => renderEntry(e))
        )}
      </div>
      {!readonly && (
        <div className={styles.inputArea}>
          {replyTo && (
            <div className={styles.replyingTo}>
              <span>Replying to thread</span>
              <button
                className={styles.entryActionButton}
                onClick={() => setReplyTo(null)}
              >
                Cancel
              </button>
            </div>
          )}
          {mentionQuery !== null && filteredMembers.length > 0 && (
            <div className={styles.mentionMenu}>
              {filteredMembers.map((m: Member, idx: number) => (
                <div
                  key={m.id}
                  className={styles.mentionItem}
                  data-active={idx === activeMentionIdx ? 'true' : 'false'}
                  onMouseDown={e => {
                    e.preventDefault();
                    insertMention(m);
                  }}
                >
                  {m.name ?? m.email ?? m.id}
                </div>
              ))}
            </div>
          )}
          <textarea
            ref={textareaRef}
            className={styles.textarea}
            placeholder="Add an update… use @ to mention. ⌘/Ctrl+Enter to send."
            value={draft}
            onChange={onDraftChange}
            onKeyDown={onDraftKeyDown}
          />
          <div className={styles.footerRow}>
            <span>
              {lastEntry
                ? `${entryCount} entries · last ${formatRelativeTime(
                    lastEntry.timestamp
                  )}`
                : 'No entries yet'}
            </span>
            <button
              className={styles.submitButton}
              disabled={!draft.trim()}
              onClick={submit}
            >
              {replyTo ? 'Reply' : 'Add'}
            </button>
          </div>
        </div>
      )}
    </>
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
        items={popoverContent}
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
