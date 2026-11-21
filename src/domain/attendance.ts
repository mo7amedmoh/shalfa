export type AttendanceDay = {
  date: string;
  day: number;
  isFriday: boolean;
  isNonWorking: boolean;
};

export type AttendanceSummary = {
  presentDays: number;
  dayOffs: number;
};

export function getAttendanceDays(month: string, nonWorkingWeekdays: readonly number[]): AttendanceDay[] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new RangeError('Month must be a valid YYYY-MM value.');
  }
  const [yearText, monthText] = month.split('-');
  const year = Number(yearText);
  const monthNumber = Number(monthText);
  const dayCount = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return Array.from({ length: dayCount }, (_, index) => {
    const day = index + 1;
    const date = `${month}-${String(day).padStart(2, '0')}`;
    const weekday = new Date(Date.UTC(year, monthNumber - 1, day)).getUTCDay();
    return { date, day, isFriday: weekday === 5, isNonWorking: nonWorkingWeekdays.includes(weekday) };
  });
}

export function summarizeAttendance(
  presentDates: ReadonlySet<string>,
  days: readonly AttendanceDay[],
): AttendanceSummary {
  return {
    presentDays: days.reduce((count, day) => count + Number(presentDates.has(day.date)), 0),
    dayOffs: days.reduce((count, day) => count + Number(day.isNonWorking), 0),
  };
}

export function isBulkAttendanceDateAllowed(
  date: string,
  month: string,
  nonWorkingWeekdays: readonly number[],
  today: string,
): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date.slice(0, 7) !== month || date > today) return false;
  const parsedDate = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) return false;
  return !nonWorkingWeekdays.includes(parsedDate.getUTCDay());
}

export function getAbsentRosterIds(
  rosterIds: readonly string[],
  presentRosterIds: ReadonlySet<string>,
  date: string,
  month: string,
  nonWorkingWeekdays: readonly number[],
  today: string,
): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date.slice(0, 7) !== month || date > today) return [];
  const parsedDate = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) return [];
  if (nonWorkingWeekdays.includes(parsedDate.getUTCDay())) return [];
  return rosterIds.filter((rosterId) => !presentRosterIds.has(rosterId));
}
