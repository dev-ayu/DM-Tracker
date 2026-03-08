const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // UTC+5:30

/** Today's date as YYYY-MM-DD in IST */
export const todayIST = (): string =>
  new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);

/** Day-of-week (0=Sun … 6=Sat) for a Date, evaluated in IST */
export const getDayIST = (d: Date): number =>
  new Date(d.getTime() + IST_OFFSET_MS).getUTCDay();

/**
 * Returns the UTC ISO timestamp of today's midnight in IST.
 * Use this when comparing against TIMESTAMPTZ columns (e.g. followed_at)
 * so the cutoff is exactly IST midnight, not UTC midnight.
 * e.g. on March 8 IST → returns "2026-03-07T18:30:00.000Z"
 */
export const todayISTMidnight = (): string => {
  const istNow = Date.now() + IST_OFFSET_MS;
  const istMidnight = istNow - (istNow % (24 * 60 * 60 * 1000));
  return new Date(istMidnight - IST_OFFSET_MS).toISOString();
};

/**
 * Returns a future DATE string (YYYY-MM-DD) that is N days from today in IST.
 * Safe to call at any time of day — always uses IST today as the base.
 * Use this for requeue_after and similar future DATE fields.
 */
export const futureDateIST = (daysFromNow: number): string => {
  const base = new Date(todayIST() + "T00:00:00Z");
  base.setUTCDate(base.getUTCDate() + daysFromNow);
  return base.toISOString().slice(0, 10);
};
