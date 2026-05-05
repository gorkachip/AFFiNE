import { LiveData, Service } from '@toeverything/infra';
import { BehaviorSubject } from 'rxjs';

import { type WorkspaceService } from '../../workspace';

interface PerEntryState {
  done?: boolean;
  snoozedUntil?: number;
}

type StateMap = Record<string, PerEntryState>;

const STORAGE_PREFIX = 'mojo:deadlines-ui-state:';

/**
 * MOJO: per-user UI state for the /deadlines page (`done` flag and
 * snoozed-until timestamp). Persisted in localStorage so it doesn't
 * touch the workspace ORM schema — that path is too risky to migrate
 * for existing workspaces (a previous attempt to add `done` /
 * `snoozedUntil` columns to the deadlines table left the entire web
 * bundle in a blank screen on workspaces that already had data).
 *
 * Trade-off: state isn't synced across devices. That's acceptable for
 * "I marked this card done on my laptop" UX — when it ever needs to
 * be cross-device we'll port it back to the workspace DB with a
 * migration plan.
 */
export class DeadlineUiStateService extends Service {
  private readonly storageKey: string;
  private readonly state$ = new BehaviorSubject<StateMap>({});

  states$ = LiveData.from<StateMap>(this.state$, {});

  constructor(private readonly workspaceService: WorkspaceService) {
    super();
    this.storageKey = `${STORAGE_PREFIX}${this.workspaceService.workspace.id}`;
    this.state$.next(this.read());
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', this.handleStorageEvent);
    }
  }

  override dispose() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', this.handleStorageEvent);
    }
    super.dispose();
  }

  private readonly handleStorageEvent = (event: StorageEvent) => {
    if (event.key !== this.storageKey) return;
    this.state$.next(this.read());
  };

  private read(): StateMap {
    if (typeof window === 'undefined') return {};
    try {
      const raw = window.localStorage.getItem(this.storageKey);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? (parsed as StateMap) : {};
    } catch {
      return {};
    }
  }

  private write(state: StateMap) {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(this.storageKey, JSON.stringify(state));
    } catch {
      // Quota exceeded or storage disabled — best effort.
    }
  }

  private mutate(id: string, patch: PerEntryState) {
    const current = this.state$.value;
    const existing = current[id] ?? {};
    const next = { ...existing, ...patch };
    // Drop entries that are back to default to keep the JSON small.
    if (next.done == null && next.snoozedUntil == null) {
      const { [id]: _, ...rest } = current;
      this.state$.next(rest);
      this.write(rest);
    } else {
      const updated = { ...current, [id]: next };
      this.state$.next(updated);
      this.write(updated);
    }
  }

  isDone(id: string): boolean {
    return !!this.state$.value[id]?.done;
  }

  getSnoozedUntil(id: string): number | undefined {
    return this.state$.value[id]?.snoozedUntil;
  }

  markDone(id: string, done: boolean) {
    this.mutate(id, { done: done || undefined });
  }

  /** Push the deadline forward by `days` from the current effective date. */
  snoozeByDays(id: string, days: number, currentEffective: number) {
    const snoozedUntil = currentEffective + days * 24 * 60 * 60 * 1000;
    this.mutate(id, { snoozedUntil });
  }

  snoozeUntil(id: string, until: number) {
    this.mutate(id, { snoozedUntil: until });
  }

  clearSnooze(id: string) {
    this.mutate(id, { snoozedUntil: undefined });
  }
}
