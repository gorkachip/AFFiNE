import { Service } from '@toeverything/infra';

/**
 * MOJO folder lock helpers.
 *
 * Lock is stored as an optional JSON string on the folder row:
 *   { lockedBy: userId, lockedAt: timestamp }
 *
 * - No lock set → unlocked.
 * - Lock set → folder (and every doc inside, recursively) is read-only.
 *   Editor renders a banner. Delete / rename / move are blocked.
 * - Only workspace owners/admins can flip the lock. Creator cannot.
 *
 * NOTE: this is UI-level only; the folder row still syncs via Yjs to every
 * client. Not a security boundary — a determined user with DevTools can
 * bypass. Suitable for trust-based teams (≤ ~30 people).
 */

export interface FolderLock {
  lockedBy: string;
  lockedAt: number;
}

export function parseLock(raw: string | null | undefined): FolderLock | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<FolderLock>;
    if (typeof parsed.lockedBy !== 'string' || !parsed.lockedBy) return null;
    return {
      lockedBy: parsed.lockedBy,
      lockedAt:
        typeof parsed.lockedAt === 'number' ? parsed.lockedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

export function serializeLock(lock: FolderLock | null): string | undefined {
  if (!lock) return undefined;
  return JSON.stringify({
    lockedBy: lock.lockedBy,
    lockedAt: lock.lockedAt,
  });
}

export function isFolderLocked(raw: string | null | undefined): boolean {
  return parseLock(raw) !== null;
}

export function canUserToggleLock(isWorkspaceOwnerOrAdmin: boolean): boolean {
  return isWorkspaceOwnerOrAdmin;
}

export class FolderLockService extends Service {
  parse = parseLock;
  serialize = serializeLock;
  isLocked = isFolderLocked;
  canToggle = canUserToggleLock;
}
