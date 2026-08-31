const DEFAULTS = { newHours: 24, midHours: 72, oldHours: 168, errorHours: 1 };
const positive = value => { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : null; };
export const createRetryPolicy = (overrides = {}) => ({
  newHours: positive(overrides.newHours ?? overrides.VS_IMAGE_RETRY_NEW_HOURS) ?? DEFAULTS.newHours,
  midHours: positive(overrides.midHours ?? overrides.VS_IMAGE_RETRY_MID_HOURS) ?? DEFAULTS.midHours,
  oldHours: positive(overrides.oldHours ?? overrides.VS_IMAGE_RETRY_OLD_HOURS) ?? DEFAULTS.oldHours,
  errorHours: positive(overrides.errorHours ?? overrides.VS_IMAGE_RETRY_ERROR_HOURS) ?? DEFAULTS.errorHours
});
const dateMs = value => { const n = Date.parse(value ?? ''); return Number.isFinite(n) ? n : null; };
export const retryReason = ({ entry, providerName, nowMs, policy = createRetryPolicy() }) => {
  const check = entry?.providerChecks?.[providerName];
  if (!check) {
    if (entry?.status === 'REQUEST_ERROR') return { actionable: false, reason: 'LEGACY_NO_TIMESTAMP' };
    return entry?.checkedProviders?.includes(providerName) ? { actionable: false, reason: 'LEGACY_NO_TIMESTAMP' } : { actionable: true, reason: 'NEVER_CHECKED' };
  }
  const status = String(check.lastStatus ?? '').toUpperCase();
  if (status === 'MATCHED_SAFE' || status === 'IDENTITY_CONFLICT') return { actionable: false, reason: status, lastStatus: status, lastCheckedAt: check.lastCheckedAt, attemptCount: check.attemptCount ?? 0 };
  const checked = dateMs(check.lastCheckedAt); if (checked == null) return { actionable: false, reason: 'LEGACY_NO_TIMESTAMP', lastStatus: status, attemptCount: check.attemptCount ?? 0 };
  const first = dateMs(entry.firstSeenAt) ?? checked; const ageDays = Math.max(0, (nowMs - first) / 86400000);
  const cooldownHours = status === 'REQUEST_ERROR' ? policy.errorHours : ageDays <= 14 ? policy.newHours : ageDays <= 30 ? policy.midHours : policy.oldHours;
  const due = nowMs - checked >= cooldownHours * 3600000;
  return { actionable: due, reason: due ? (status === 'REQUEST_ERROR' ? 'REQUEST_ERROR_RETRY_DUE' : 'NO_MATCH_RETRY_DUE') : 'COOLDOWN', lastStatus: status, lastCheckedAt: check.lastCheckedAt, attemptCount: check.attemptCount ?? 0, cooldownHours };
};
export const providerRetryInfo = ({ entry, providerNames = [], nowMs, policy = createRetryPolicy() }) => {
  for (const provider of providerNames) { const result = retryReason({ entry, providerName: provider, nowMs, policy }); if (result.actionable) return { ...result, provider }; }
  return { actionable: false, reason: 'EXHAUSTED' };
};
