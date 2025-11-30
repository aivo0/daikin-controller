// This file handles Cloudflare Pages Functions middleware
// Including scheduled (cron) triggers

import type { PagesFunction } from '@cloudflare/workers-types';

interface Env {
	DB: D1Database;
	DAIKIN_CLIENT_ID: string;
	DAIKIN_CLIENT_SECRET: string;
	CRON_SECRET?: string;
}

// Handle scheduled events (cron triggers)
export const onRequest: PagesFunction<Env> = async (context) => {
	return context.next();
};

// This will be called by Cloudflare's cron scheduler
// Note: For Pages, you typically need to use a separate Worker for cron,
// or use the API endpoint approach (call /api/cron from an external cron service)
