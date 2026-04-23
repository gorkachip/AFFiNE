import { Service } from '@toeverything/infra';

/**
 * MOJO folder visibility helpers.
 *
 * Visibility is stored as an optional JSON string on the folder row:
 *   { mode: 'public' | 'restricted', users: string[] }
 *
 * - No visibility set → public (all workspace members see the folder).
 * - mode === 'public' → same as above.
 * - mode === 'restricted' → only listed user IDs (plus workspace owner) see it.
 *
 * NOTE: this is UI-level filtering only; the folder row is still synced via
 * Yjs to every client. Not a security boundary.
 */

export interface FolderVisibility {
  mode: 'public' | 'restricted';
  users: string[];
}

export function parseVisibility(
  raw: string | null | undefined
): FolderVisibility {
  if (!raw) return { mode: 'public', users: [] };
  try {
    const parsed = JSON.parse(raw) as Partial<FolderVisibility>;
    if (parsed.mode === 'restricted') {
      return {
        mode: 'restricted',
        users: Array.isArray(parsed.users) ? parsed.users : [],
      };
    }
    return { mode: 'public', users: [] };
  } catch {
    return { mode: 'public', users: [] };
  }
}

export function serializeVisibility(v: FolderVisibility): string | undefined {
  if (v.mode === 'public') return undefined;
  return JSON.stringify({ mode: 'restricted', users: v.users });
}

export function canUserSeeFolder(
  visibility: FolderVisibility,
  userId: string | null,
  isWorkspaceOwnerOrAdmin: boolean
): boolean {
  if (visibility.mode === 'public') return true;
  if (isWorkspaceOwnerOrAdmin) return true;
  if (!userId) return false;
  return visibility.users.includes(userId);
}

export class FolderVisibilityService extends Service {
  parse = parseVisibility;
  serialize = serializeVisibility;
  canUserSee = canUserSeeFolder;
}
