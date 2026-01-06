import { betterAuth } from 'better-auth';
import { D1Dialect } from 'kysely-d1';

interface AuthEnv {
	DB: D1Database;
	GOOGLE_CLIENT_ID: string;
	GOOGLE_CLIENT_SECRET: string;
	BETTER_AUTH_SECRET: string;
	BETTER_AUTH_URL?: string;
}

/**
 * Create auth instance with D1 database binding
 * Must be called per-request since D1 binding is only available in request context
 */
export function createAuth(env: AuthEnv) {
	return betterAuth({
		database: {
			dialect: new D1Dialect({ database: env.DB }),
			type: 'sqlite'
		},
		secret: env.BETTER_AUTH_SECRET,
		baseURL: env.BETTER_AUTH_URL || 'http://localhost:5173',
		socialProviders: {
			google: {
				clientId: env.GOOGLE_CLIENT_ID,
				clientSecret: env.GOOGLE_CLIENT_SECRET
			}
		},
		session: {
			expiresIn: 60 * 60 * 24 * 7, // 7 days
			updateAge: 60 * 60 * 24 // Update session every 24 hours
		},
		user: {
			deleteUser: {
				enabled: true
			}
		}
	});
}

export type Auth = ReturnType<typeof createAuth>;
