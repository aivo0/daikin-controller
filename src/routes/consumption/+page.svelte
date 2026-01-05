<script lang="ts">
	import type { PageData } from './$types';
	import ConsumptionChart from '$lib/components/ConsumptionChart.svelte';
	import HourlyConsumptionChart from '$lib/components/HourlyConsumptionChart.svelte';
	import { t, dateLocale } from '$lib/i18n';

	let { data }: { data: PageData } = $props();

	let viewMode: 'daily' | 'hourly' = $state('hourly');
</script>

<h1 class="text-2xl font-bold mb-6">{$t.consumption.title}</h1>

{#if data.error}
	<div class="alert alert-error mb-4">
		<span>{data.error}</span>
	</div>
{/if}

{#if data.summary}
	<!-- Summary cards -->
	<div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
		<div class="stat bg-base-100 rounded-lg shadow">
			<div class="stat-title">{$t.consumption.totalHeating}</div>
			<div class="stat-value text-primary text-2xl">{data.summary.total_heating.toFixed(1)}</div>
			<div class="stat-desc">{$t.consumption.kwh} ({data.summary.days} {$t.consumption.days})</div>
		</div>
		<div class="stat bg-base-100 rounded-lg shadow">
			<div class="stat-title">{$t.consumption.totalDhw}</div>
			<div class="stat-value text-secondary text-2xl">{data.summary.total_dhw.toFixed(1)}</div>
			<div class="stat-desc">{$t.consumption.kwh}</div>
		</div>
		<div class="stat bg-base-100 rounded-lg shadow">
			<div class="stat-title">{$t.consumption.total}</div>
			<div class="stat-value text-2xl">{data.summary.total_kwh.toFixed(1)}</div>
			<div class="stat-desc">{$t.consumption.kwh}</div>
		</div>
		<div class="stat bg-base-100 rounded-lg shadow">
			<div class="stat-title">{$t.consumption.estimatedCost}</div>
			<div class="stat-value text-accent text-2xl">{(data.summary.total_cost / 100).toFixed(2)}</div>
			<div class="stat-desc">{$t.consumption.eur}</div>
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
			{$t.consumption.viewHourly}
		</button>
		<button
			class="btn btn-sm"
			class:btn-active={viewMode === 'daily'}
			onclick={() => viewMode = 'daily'}
		>
			{$t.consumption.viewDaily}
		</button>
	</div>
</div>

{#if viewMode === 'hourly'}
	{#if data.hourlyData && data.hourlyData.length > 0}
		<div class="card bg-base-100 shadow-xl">
			<div class="card-body">
				<h2 class="card-title">{$t.consumption.hourlyConsumption} ({$t.consumption.last7days})</h2>
				<HourlyConsumptionChart data={data.hourlyData} />
			</div>
		</div>
	{:else}
		<div class="alert alert-info">
			<span>{$t.consumption.noHourlyData}</span>
		</div>
	{/if}
{:else}
	{#if data.dailyData && data.dailyData.length > 0}
		<div class="card bg-base-100 shadow-xl">
			<div class="card-body">
				<h2 class="card-title">{$t.consumption.dailyConsumption} ({$t.consumption.kwh})</h2>
				<ConsumptionChart data={data.dailyData} />
			</div>
		</div>
	{:else}
		<div class="alert alert-info">
			<span>{$t.consumption.noDailyData}</span>
		</div>
	{/if}
{/if}

<!-- Data table -->
{#if data.dailyData && data.dailyData.length > 0}
	<div class="card bg-base-100 shadow-xl mt-6">
		<div class="card-body">
			<h2 class="card-title">{$t.consumption.detailedOverview}</h2>
			<div class="overflow-x-auto">
				<table class="table table-zebra">
					<thead>
						<tr>
							<th>{$t.consumption.date}</th>
							<th class="text-right">{$t.consumption.heating}</th>
							<th class="text-right">{$t.consumption.dhw}</th>
							<th class="text-right">{$t.consumption.total}</th>
							<th class="text-right">{$t.consumption.avgPrice}</th>
							<th class="text-right">{$t.consumption.cost}</th>
						</tr>
					</thead>
					<tbody>
						{#each [...data.dailyData].reverse() as day}
							<tr>
								<td>
									{new Date(day.date).toLocaleDateString($dateLocale, {
										weekday: 'short',
										day: 'numeric',
										month: 'short'
									})}
								</td>
								<td class="text-right">{day.heating_kwh.toFixed(1)} {$t.consumption.kwh}</td>
								<td class="text-right">{day.dhw_kwh.toFixed(1)} {$t.consumption.kwh}</td>
								<td class="text-right font-medium">{day.total_kwh.toFixed(1)} {$t.consumption.kwh}</td>
								<td class="text-right">{day.avg_price.toFixed(1)} {$t.consumption.cents}/{$t.consumption.kwh}</td>
								<td class="text-right">{(day.estimated_cost / 100).toFixed(2)} {$t.consumption.eur}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	</div>
{/if}
