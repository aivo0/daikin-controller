<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	function formatDate(timestamp: string): string {
		return new Date(timestamp).toLocaleString('et-EE', {
			day: '2-digit',
			month: '2-digit',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function getActionBadgeClass(action: string): string {
		switch (action) {
			case 'boost':
				return 'badge-success';
			case 'reduce':
				return 'badge-error';
			case 'normal':
				return 'badge-warning';
			default:
				return 'badge-ghost';
		}
	}

	function translateAction(action: string): string {
		const translations: Record<string, string> = {
			boost: 'KÜTMINE',
			normal: 'TAVALINE',
			reduce: 'VÄHENDATUD',
			none: 'PUUDUB'
		};
		return translations[action] || action.toUpperCase();
	}
</script>

<h1 class="text-2xl font-bold mb-6">Juhtimisajalugu</h1>

{#if data.error}
	<div class="alert alert-error mb-4">
		<span>{data.error}</span>
	</div>
{/if}

<div class="card bg-base-100 shadow-xl">
	<div class="card-body">
		{#if data.logs.length === 0}
			<p class="text-center py-8 opacity-50">Juhtimistoiminguid pole veel salvestatud</p>
		{:else}
			<div class="overflow-x-auto">
				<table class="table table-zebra">
					<thead>
						<tr>
							<th>Aeg</th>
							<th>Tegevus</th>
							<th>Hind</th>
							<th>Temperatuuri muutus</th>
							<th>Põhjus</th>
						</tr>
					</thead>
					<tbody>
						{#each data.logs as log}
							<tr>
								<td class="whitespace-nowrap">
									{formatDate(log.timestamp)}
								</td>
								<td>
									<span class="badge {getActionBadgeClass(log.action)}">
										{translateAction(log.action)}
									</span>
								</td>
								<td>
									{#if log.price_eur_mwh !== null}
										{(log.price_eur_mwh / 10).toFixed(2)} senti/kWh
									{:else}
										--
									{/if}
								</td>
								<td>
									{#if log.old_target_temp !== null && log.new_target_temp !== null}
										<span class="opacity-70">{log.old_target_temp}°C</span>
										<span class="mx-1">→</span>
										<span class="font-bold">{log.new_target_temp}°C</span>
									{:else}
										--
									{/if}
								</td>
								<td class="max-w-md">
									<span class="text-sm opacity-70">{log.reason ?? '--'}</span>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
</div>
