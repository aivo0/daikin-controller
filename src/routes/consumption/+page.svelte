<script lang="ts">
	import type { PageData } from './$types';
	import ConsumptionChart from '$lib/components/ConsumptionChart.svelte';
	import HourlyConsumptionChart from '$lib/components/HourlyConsumptionChart.svelte';

	let { data }: { data: PageData } = $props();

	let viewMode: 'daily' | 'hourly' = $state('hourly');
</script>

<h1 class="text-2xl font-bold mb-6">Energiatarbimine</h1>

{#if data.error}
	<div class="alert alert-error mb-4">
		<span>{data.error}</span>
	</div>
{/if}

{#if data.summary}
	<!-- Summary cards -->
	<div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
		<div class="stat bg-base-100 rounded-lg shadow">
			<div class="stat-title">Küte kokku</div>
			<div class="stat-value text-primary text-2xl">{data.summary.total_heating.toFixed(1)}</div>
			<div class="stat-desc">kWh ({data.summary.days} päeva)</div>
		</div>
		<div class="stat bg-base-100 rounded-lg shadow">
			<div class="stat-title">Boiler kokku</div>
			<div class="stat-value text-secondary text-2xl">{data.summary.total_dhw.toFixed(1)}</div>
			<div class="stat-desc">kWh</div>
		</div>
		<div class="stat bg-base-100 rounded-lg shadow">
			<div class="stat-title">Kokku</div>
			<div class="stat-value text-2xl">{data.summary.total_kwh.toFixed(1)}</div>
			<div class="stat-desc">kWh</div>
		</div>
		<div class="stat bg-base-100 rounded-lg shadow">
			<div class="stat-title">Hinnanguline kulu</div>
			<div class="stat-value text-accent text-2xl">{(data.summary.total_cost / 100).toFixed(2)}</div>
			<div class="stat-desc">EUR</div>
		</div>
	</div>
{/if}

<!-- View toggle -->
<div class="flex justify-end mb-4">
	<div class="btn-group">
		<button
			class="btn btn-sm"
			class:btn-active={viewMode === 'hourly'}
			onclick={() => viewMode = 'hourly'}
		>
			Tunnipõhine
		</button>
		<button
			class="btn btn-sm"
			class:btn-active={viewMode === 'daily'}
			onclick={() => viewMode = 'daily'}
		>
			Päevapõhine
		</button>
	</div>
</div>

{#if viewMode === 'hourly'}
	{#if data.hourlyData && data.hourlyData.length > 0}
		<div class="card bg-base-100 shadow-xl">
			<div class="card-body">
				<h2 class="card-title">Tunnipõhine tarbimine (viimased 7 päeva)</h2>
				<HourlyConsumptionChart data={data.hourlyData} />
			</div>
		</div>
	{:else}
		<div class="alert alert-info">
			<span>Tunnipõhised andmed puuduvad. Andmed ilmuvad peale esimest cron tsüklit.</span>
		</div>
	{/if}
{:else}
	{#if data.dailyData && data.dailyData.length > 0}
		<div class="card bg-base-100 shadow-xl">
			<div class="card-body">
				<h2 class="card-title">Päevane tarbimine (kWh)</h2>
				<ConsumptionChart data={data.dailyData} />
			</div>
		</div>
	{:else}
		<div class="alert alert-info">
			<span>Tarbimisandmed puuduvad. Andmed ilmuvad peale esimest cron tsüklit.</span>
		</div>
	{/if}
{/if}

<!-- Data table -->
{#if data.dailyData && data.dailyData.length > 0}
	<div class="card bg-base-100 shadow-xl mt-6">
		<div class="card-body">
			<h2 class="card-title">Detailne ülevaade (päevad)</h2>
			<div class="overflow-x-auto">
				<table class="table table-zebra">
					<thead>
						<tr>
							<th>Kuupäev</th>
							<th class="text-right">Küte</th>
							<th class="text-right">Boiler</th>
							<th class="text-right">Kokku</th>
							<th class="text-right">Kesk. hind</th>
							<th class="text-right">Kulu</th>
						</tr>
					</thead>
					<tbody>
						{#each [...data.dailyData].reverse() as day}
							<tr>
								<td>
									{new Date(day.date).toLocaleDateString('et-EE', {
										weekday: 'short',
										day: 'numeric',
										month: 'short'
									})}
								</td>
								<td class="text-right">{day.heating_kwh.toFixed(1)} kWh</td>
								<td class="text-right">{day.dhw_kwh.toFixed(1)} kWh</td>
								<td class="text-right font-medium">{day.total_kwh.toFixed(1)} kWh</td>
								<td class="text-right">{day.avg_price.toFixed(1)} s/kWh</td>
								<td class="text-right">{(day.estimated_cost / 100).toFixed(2)} EUR</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	</div>
{/if}
