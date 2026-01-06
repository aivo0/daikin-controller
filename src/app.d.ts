// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface Locals {
			user: {
				id: string;
				email: string;
				name: string;
				image?: string | null;
			} | null;
			session: {
				id: string;
				userId: string;
				expiresAt: Date;
			} | null;
		}
		interface Platform {
			env: {
				DB: D1Database;
				DAIKIN_CLIENT_ID: string;
				DAIKIN_CLIENT_SECRET: string;
				GOOGLE_CLIENT_ID: string;
				GOOGLE_CLIENT_SECRET: string;
				BETTER_AUTH_SECRET: string;
				BETTER_AUTH_URL: string;
				CRON_SECRET?: string;
			};
			context: {
				waitUntil(promise: Promise<unknown>): void;
			};
			caches: CacheStorage & { default: Cache };
		}
	}
}

export {};
