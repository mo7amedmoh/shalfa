export type ExistingAttendanceWorker = {
  id: string;
  worker_id_number: string | null;
};

export type AttendanceRosterImportPlan = {
  deleted: ExistingAttendanceWorker[];
  addedCount: number;
  deletedWithAttendanceCount: number;
};

export function normalizeAttendanceIdentity(value: string): string {
  return value.trim()
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x6f0));
}

export function planAttendanceRosterImport(
  existing: readonly ExistingAttendanceWorker[],
  importedIdentities: readonly (string | null)[],
  rosterIdsWithAttendance: ReadonlySet<string>,
): AttendanceRosterImportPlan {
  const existingByIdentity = new Map<string, ExistingAttendanceWorker[]>();
  for (const worker of existing) {
    const identity = worker.worker_id_number ? normalizeAttendanceIdentity(worker.worker_id_number) : '';
    if (!identity) continue;
    const matches = existingByIdentity.get(identity) ?? [];
    matches.push(worker);
    existingByIdentity.set(identity, matches);
  }

  const matchedIds = new Set<string>();
  let addedCount = 0;
  for (const value of importedIdentities) {
    const identity = value ? normalizeAttendanceIdentity(value) : '';
    const match = identity
      ? existingByIdentity.get(identity)?.find((worker) => !matchedIds.has(worker.id))
      : undefined;
    if (match) matchedIds.add(match.id);
    else addedCount += 1;
  }

  const deleted = existing.filter((worker) => !matchedIds.has(worker.id));
  return {
    deleted,
    addedCount,
    deletedWithAttendanceCount: deleted.filter((worker) => rosterIdsWithAttendance.has(worker.id)).length,
  };
}
