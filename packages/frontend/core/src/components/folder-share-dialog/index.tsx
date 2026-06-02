import { Button, Input, Modal, RadioGroup } from '@affine/component';
import { AuthService } from '@affine/core/modules/cloud';
import type { FolderNode } from '@affine/core/modules/organize';
import {
  parseVisibility,
  serializeVisibility,
} from '@affine/core/modules/organize';
import { MemberSearchService } from '@affine/core/modules/permissions';
import { useLiveData, useService } from '@toeverything/infra';
import { useCallback, useEffect, useMemo, useState } from 'react';

interface FolderShareDialogProps {
  folder: FolderNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const checkboxStyle = {
  WebkitAppearance: 'checkbox',
  MozAppearance: 'checkbox',
  appearance: 'checkbox',
  width: '16px',
  height: '16px',
  cursor: 'pointer',
  flexShrink: 0,
} as const;

/**
 * MOJO folder visibility dialog. Lets the workspace decide whether a folder
 * shows for everyone or only a chosen subset of workspace members.
 *
 * Phase 1: UI-only filter. Data still syncs to all clients via Yjs.
 *
 * Safety nets:
 * - On save in 'restricted' mode, automatically include the current user's ID
 *   so they can't lock themselves out of folders they own.
 * - Checkboxes use forced appearance: checkbox to override the global
 *   `-webkit-appearance: none` reset on inputs.
 */
export const FolderShareDialog = ({
  folder,
  open,
  onOpenChange,
}: FolderShareDialogProps) => {
  const memberSearchService = useService(MemberSearchService);
  const authService = useService(AuthService);
  const results = useLiveData(memberSearchService.result$);
  const hasMore = useLiveData(memberSearchService.hasMore$);
  const isLoading = useLiveData(memberSearchService.isLoading$);
  const currentUserId = useLiveData(
    authService.session.account$.map(a => a?.id ?? null)
  );

  const folderName = useLiveData(folder.name$);
  const visibilityRaw = useLiveData(folder.visibility$);
  const initial = useMemo(
    () => parseVisibility(visibilityRaw),
    [visibilityRaw]
  );

  const [mode, setMode] = useState<'public' | 'restricted'>(initial.mode);
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(
    new Set(initial.users)
  );
  const [searchInput, setSearchInput] = useState('');

  useEffect(() => {
    if (open) {
      // Default: include current user so they always see the folder.
      const seed = new Set(initial.users);
      if (currentUserId) seed.add(currentUserId);
      setMode(initial.mode);
      setSelectedUsers(seed);
      setSearchInput('');
      memberSearchService.search('');
    }
  }, [open, initial.mode, initial.users, memberSearchService, currentUserId]);

  // MOJO: debounce the search input so each keystroke doesn't fire a
  // graphql query. 200ms is short enough to feel live, long enough to
  // coalesce typing in a 9–30 person workspace.
  useEffect(() => {
    if (!open) return;
    const handle = setTimeout(() => {
      memberSearchService.search(searchInput.trim() || '');
    }, 200);
    return () => clearTimeout(handle);
  }, [open, searchInput, memberSearchService]);

  const toggleUser = useCallback(
    (userId: string) => {
      setSelectedUsers(prev => {
        const next = new Set(prev);
        if (next.has(userId)) {
          // Don't allow user to remove themselves — they would lose access.
          if (userId === currentUserId) return prev;
          next.delete(userId);
        } else {
          next.add(userId);
        }
        return next;
      });
    },
    [currentUserId]
  );

  const handleSave = useCallback(() => {
    if (mode === 'public') {
      // Write an explicit empty string so the ORM overwrites any prior
      // 'restricted' JSON. parseVisibility() treats '' as public.
      folder.setVisibility('');
    } else {
      // Always include the current user as a safety net.
      const users = new Set(selectedUsers);
      if (currentUserId) users.add(currentUserId);
      const serialized = serializeVisibility({
        mode: 'restricted',
        users: Array.from(users),
      });
      folder.setVisibility(serialized ?? '');
    }
    onOpenChange(false);
  }, [folder, mode, onOpenChange, selectedUsers, currentUserId]);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`Share folder: ${folderName ?? ''}`}
      description="Choose who can see this folder. You will always see folders you share."
      width={520}
    >
      <div style={{ padding: '8px 0 16px' }}>
        <RadioGroup
          value={mode}
          onChange={v => setMode(v as 'public' | 'restricted')}
          items={[
            { value: 'public', label: 'Workspace (everyone)' },
            { value: 'restricted', label: 'Specific people' },
          ]}
        />
      </div>

      {mode === 'restricted' && (
        <div style={{ marginBottom: 16 }}>
          <Input
            placeholder="Search members by name or email…"
            value={searchInput}
            onChange={value => setSearchInput(value)}
            style={{ marginBottom: 8 }}
            data-testid="folder-share-search"
          />
          <div
            style={{
              maxHeight: 320,
              overflowY: 'auto',
              border: '1px solid var(--affine-border-color)',
              borderRadius: 8,
              padding: 8,
            }}
          >
            {isLoading && results.length === 0 ? (
              <div style={{ padding: 16, textAlign: 'center' }}>Loading…</div>
            ) : results.length > 0 ? (
              results.map(m => {
                const isSelf = m.id === currentUserId;
                return (
                  <label
                    key={m.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '8px 6px',
                      cursor: isSelf ? 'not-allowed' : 'pointer',
                      opacity: isSelf ? 0.7 : 1,
                    }}
                    title={isSelf ? 'You always have access' : ''}
                  >
                    <input
                      type="checkbox"
                      style={checkboxStyle}
                      checked={selectedUsers.has(m.id)}
                      disabled={isSelf}
                      onChange={() => toggleUser(m.id)}
                    />
                    <span>
                      {m.name ?? m.email ?? m.id}
                      {isSelf ? ' (you)' : ''}
                    </span>
                  </label>
                );
              })
            ) : (
              <div
                style={{
                  padding: 16,
                  textAlign: 'center',
                  color: 'var(--affine-text-secondary-color)',
                  fontSize: 13,
                }}
              >
                {searchInput.trim()
                  ? `No members match "${searchInput.trim()}".`
                  : 'No members loaded.'}
              </div>
            )}
            {hasMore && results.length > 0 && (
              <div style={{ paddingTop: 8, textAlign: 'center' }}>
                <Button
                  size="small"
                  onClick={() => memberSearchService.loadMore()}
                  disabled={isLoading}
                >
                  {isLoading ? 'Loading…' : 'Load more'}
                </Button>
              </div>
            )}
          </div>
          <div
            style={{
              fontSize: 11,
              color: 'var(--affine-text-secondary-color)',
              marginTop: 6,
            }}
          >
            {selectedUsers.size} selected
          </div>
        </div>
      )}

      <div
        style={{
          display: 'flex',
          gap: 8,
          justifyContent: 'flex-end',
        }}
      >
        <Button onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button variant="primary" onClick={handleSave}>
          Save
        </Button>
      </div>
    </Modal>
  );
};
