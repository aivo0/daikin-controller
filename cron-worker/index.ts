/**
 * Cloudflare Worker for triggering the Daikin Controller cron job
 * Deploy this separately from the main SvelteKit app
 *
 * Setup:
 * 1. cd cron-worker
 * 2. wrangler deploy
 * 3. wrangler secret put CRON_SECRET
 */

interface Env {
	APP_URL: string;
	CRON_SECRET: string;
}

export default {
	async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
		console.log(`Cron triggered at ${new Date().toISOString()}`);

		const url = `${env.APP_URL}/api/cron`;

		try {
			const response = await fetch(url, {
				method: 'GET',
				headers: {
					'x-cron-secret': env.CRON_SECRET,
					'User-Agent': 'Daikin-Cron-Worker/1.0'
				}
			});

			const result = await response.json();

			console.log('Cron result:', JSON.stringify(result));

			if (!response.ok) {
				console.error(`Cron request failed: ${response.status}`);
			}
		} catch (error) {
			console.error('Cron error:', error);
		}
	},

	// Also handle HTTP requests for testing
	async fetch(request: Request, env: Env): Promise<Response> {
		return new Response(
			JSON.stringify({
				status: 'ok',
				message: 'Daikin Cron Worker',
				app_url: env.APP_URL,
				next_run: 'Every 15 minutes'
			}),
			{
				headers: { 'Content-Type': 'application/json' }
			}
		);
	}
};
