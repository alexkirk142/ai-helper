/**
 * Business constants — centralised values that change with business rules.
 * Do NOT hardcode these values in service files.
 */

/** Monthly subscription price in USDT (channels access) */
export const SUBSCRIPTION_PRICE_USDT = 50;

/** Monthly AI Agent subscription price in USDT */
export const AI_SUBSCRIPTION_PRICE_USDT = 30;

/** Trial period duration in hours */
export const TRIAL_PERIOD_HOURS = 72;

/** Maximum Telegram personal accounts per tenant */
export const MAX_TELEGRAM_ACCOUNTS_PER_TENANT = 5;

/** Number of MAX Personal accounts included free with an active channels subscription */
export const FREE_MAX_PERSONAL_ACCOUNTS = 5;

/** Monthly price in USDT for extra MAX Personal accounts beyond the free limit */
export const EXTRA_MAX_ACCOUNTS_PRICE_USDT = 10;

/** Maximum discount percent allowed by default */
export const DEFAULT_MAX_DISCOUNT_PERCENT = 0;
