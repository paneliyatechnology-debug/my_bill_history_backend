export function getDaysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export interface RecurrenceParams {
  frequency: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY" | string;
  interval?: number;
  dayOfWeek?: number | null; // 0 (Sun) - 6 (Sat)
  dayOfMonth?: number | null; // 1 - 31
  startDate: Date;
  endDate?: Date | null;
  fromDate?: Date; // compute next after this date (defaults to startDate or now)
}

/**
 * Calculates the next eligible execution date based on recurrence rules.
 * Honors month-end boundaries (e.g., 31st clamped to 28/30) and leap years.
 */
export function calculateNextOccurrence(params: RecurrenceParams): Date | null {
  const interval = Math.max(1, params.interval || 1);
  const freq = (params.frequency || "MONTHLY").toUpperCase();
  const start = new Date(params.startDate);
  const base = params.fromDate ? new Date(params.fromDate) : new Date(start);

  let next: Date;

  switch (freq) {
    case "DAILY": {
      next = new Date(base);
      next.setUTCDate(next.getUTCDate() + interval);
      break;
    }

    case "WEEKLY": {
      next = new Date(base);
      if (params.dayOfWeek !== undefined && params.dayOfWeek !== null) {
        const currentDow = next.getUTCDay();
        let diff = (params.dayOfWeek - currentDow + 7) % 7;
        if (diff === 0) {
          diff = 7 * interval;
        }
        next.setUTCDate(next.getUTCDate() + diff);
      } else {
        next.setUTCDate(next.getUTCDate() + 7 * interval);
      }
      break;
    }

    case "MONTHLY": {
      const currentYear = base.getUTCFullYear();
      const currentMonth = base.getUTCMonth();
      const targetDay = params.dayOfMonth || start.getUTCDate();

      const nextMonthTotal = currentMonth + interval;
      const targetYear = currentYear + Math.floor(nextMonthTotal / 12);
      const targetMonth = nextMonthTotal % 12;

      const maxDaysInTargetMonth = getDaysInMonth(targetYear, targetMonth);
      const clampedDay = Math.min(targetDay, maxDaysInTargetMonth);

      next = new Date(Date.UTC(targetYear, targetMonth, clampedDay, start.getUTCHours(), start.getUTCMinutes(), 0, 0));
      break;
    }

    case "YEARLY": {
      const targetYear = base.getUTCFullYear() + interval;
      const targetMonth = start.getUTCMonth();
      let targetDay = start.getUTCDate();

      // Handle leap year Feb 29
      if (targetMonth === 1 && targetDay === 29 && !isLeapYear(targetYear)) {
        targetDay = 28;
      }

      next = new Date(Date.UTC(targetYear, targetMonth, targetDay, start.getUTCHours(), start.getUTCMinutes(), 0, 0));
      break;
    }

    default:
      next = new Date(base);
      next.setUTCDate(next.getUTCDate() + 30);
  }

  if (params.endDate) {
    const end = new Date(params.endDate);
    if (next > end) {
      return null;
    }
  }

  return next;
}

/**
 * Determines initial next_run_at date on schedule creation.
 */
export function getInitialNextRun(
  startDate: Date,
  frequency: string,
  interval?: number,
  dayOfWeek?: number | null,
  dayOfMonth?: number | null,
  endDate?: Date | null,
): Date | null {
  const now = new Date();
  const start = new Date(startDate);

  // If start date is today or in the future, first run is on startDate
  if (start.getTime() >= now.setUTCHours(0, 0, 0, 0)) {
    if (endDate && start > new Date(endDate)) {
      return null;
    }
    return start;
  }

  // If start date is in the past, calculate forward until >= today
  let current: Date | null = new Date(start);
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  while (current && current.getTime() < todayStart.getTime()) {
    current = calculateNextOccurrence({
      frequency,
      interval,
      dayOfWeek,
      dayOfMonth,
      startDate: start,
      endDate,
      fromDate: current,
    });
  }

  return current;
}
