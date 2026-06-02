import { Button, Input, Modal, notify, RadioGroup } from '@affine/component';
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
  // MOJO: root folders (no parentId) can't "inherit from parent" because
  // there's no parent — hide the option in that case.
  const folderInfo = useLiveData(folder.info$);
  const hasParent = folderInfo?.parentId != null;
  const initial = useMemo(
    () => parseVisibility(visibilityRaw),
    [visibilityRaw]
  );

  const [mode, setMode] = useState<'public' | 'restricted' | 'inherit'>(
    initial.mode
  );
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(
    new Set(initial.users)
  );
  const [searchInput, setSearchInput] = useState('');
  // MOJO: when true (default), save also walks descendant folders and
  // converts any that look "default-private" (restricted to a single
  // creator id) to inherit, so the share cascades down through the
  // pre-existing subfolders. Hidden when mode is 'inherit' (would be a
  // no-op).
  const [cascadeToChildren, setCascadeToChildren] = useState(true);

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
      // 'restricted'/'inherit' JSON. parseVisibility() treats '' as public.
      folder.setVisibility('');
    } else if (mode === 'inherit') {
      const serialized = serializeVisibility({ mode: 'inherit', users: [] });
      folder.setVisibility(serialized ?? '');
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

    // MOJO: bulk-cascade. Walk every descendant folder, and for the ones
    // that look "default-private" (restricted-mode list with a single
    // user id that's also their creator), flip them to inherit so the
    // share automatically reaches them. Skip:
    //   - mode inherit (already cascading)
    //   - mode public (intentionally world-visible)
    //   - mode restricted with >1 user OR a user other than the creator
    //     (looks like an explicit privacy choice; don't override it)
    // Not applicable when the parent is also set to inherit (no anchor
    // for the cascade) — checkbox is hidden in that case.
    let converted = 0;
    if (cascadeToChildren && mode !== 'inherit') {
      const inheritJson = serializeVisibility({
        mode: 'inherit',
        users: [],
      });
      const walk = (n: FolderNode) => {
        for (const child of n.children$.value) {
          if (child.type$.value !== 'folder') continue;
          if (child.trashed$.value) continue;
          const v = parseVisibility(child.visibility$.value);
          const childInfo = child.info$.value;
          const creator = childInfo?.createdBy ?? null;
          const looksDefault =
            v.mode === 'restricted' &&
            v.users.length === 1 &&
            !!creator &&
            v.users[0] === creator;
          if (looksDefault && inheritJson) {
            child.setVisibility(inheritJson);
            converted++;
          }
          walk(child);
        }
      };
      walk(folder);
      if (converted > 0) {
        notify.success({
          title: `Cascaded share to ${converted} subfolder${
            converted === 1 ? '' : 's'
          }`,
          message:
            'Subfolders that were still private to their creator now inherit from this folder.',
        });
      }
    }
    onOpenChange(false);
  }, [
    folder,
    mode,
    onOpenChange,
    selectedUsers,
    currentUserId,
    cascadeToChildren,
  ]);

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
          onChange={v => setMode(v as 'public' | 'restricted' | 'inherit')}
          items={[
            // MOJO: inherit is the cascade default for new subfolders — show
            // it only when the folder has a parent to inherit from.
            ...(hasParent
              ? [{ value: 'inherit', label: 'Inherit from parent' }]
              : []),
            { value: 'public', label: 'Workspace (everyone)' },
            { value: 'restricted', label: 'Specific people' },
          ]}
        />
      </div>
      {mode === 'inherit' && (
        <div
          style={{
            padding: 12,
            border: '1px solid var(--affine-border-color)',
            borderRadius: 8,
            background: 'var(--affine-background-secondary-color)',
            fontSize: 13,
            color: 'var(--affine-text-secondary-color)',
            marginBottom: 16,
          }}
        >
          This folder will be visible to whoever can see its parent folder.
          Share the parent to add or remove people — changes cascade down
          automatically.
        </div>
      )}

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

      {/* MOJO: cascade option is only meaningful when this folder defines
          its own audience (public / restricted). When the folder itself
          inherits, there's no anchor and the cascade is a no-op. */}
      {mode !== 'inherit' && (
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 0',
            cursor: 'pointer',
            marginBottom: 12,
            fontSize: 13,
            color: 'var(--affine-text-primary-color)',
          }}
        >
          <input
            type="checkbox"
            style={checkboxStyle}
            checked={cascadeToChildren}
            onChange={e => setCascadeToChildren(e.currentTarget.checked)}
          />
          <span>
            Cascade access to all subfolders inside
            <span
              style={{
                display: 'block',
                fontSize: 11,
                color: 'var(--affine-text-secondary-color)',
                marginTop: 2,
              }}
            >
              Existing subfolders that are still private to their creator
              will be set to inherit from this folder. Subfolders explicitly
              shared with other people are left untouched.
            </span>
          </span>
        </label>
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
