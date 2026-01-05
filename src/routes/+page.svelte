<script lang="ts">
	import type { PageData } from './$types';
	import PriceChart from '$lib/components/PriceChart.svelte';
	import DeviceStatus from '$lib/components/DeviceStatus.svelte';
	import { t } from '$lib/i18n';

	let { data }: { data: PageData } = $props();

	function translateAction(action: string): string {
		const key = action as keyof typeof $t.actions;
		return $t.actions[key] || action.toUpperCase();
	}
</script>

{#if data.error}
	<div class="alert alert-error mb-4">
		<span>{data.error}</span>
	</div>
{/if}

<!-- Price Chart (Public) -->
<div class="card bg-base-100 shadow-xl mb-6">
	<div class="card-body">
		<h2 class="card-title">{$t.dashboard.electricityPrice}</h2>
		{#if data.prices.length > 0}
			<PriceChart prices={data.prices} heatingSchedule={data.heatingSchedule} />
		{:else}
			<p class="text-center py-8 opacity-50">{$t.consumption.noData}</p>
		{/if}
	</div>
</div>

<!-- Authenticated Content -->
{#if data.isAuthenticated}
	<div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
		<!-- Current Price Card -->
		<div class="card bg-base-100 shadow-xl">
			<div class="card-body">
				<h2 class="card-title text-sm opacity-70">{$t.dashboard.currentPrice}</h2>
				{#if data.currentPrice !== null}
					<p class="text-4xl font-bold" class:text-success={data.currentPrice < 5} class:text-error={data.currentPrice > 15}>
						{data.currentPrice.toFixed(2)}
						<span class="text-lg font-normal">{$t.dashboard.centPerKwh}</span>
					</p>
				{:else}
					<p class="text-lg opacity-50">{$t.consumption.noData}</p>
				{/if}
			</div>
		</div>

		<!-- Device Status Card -->
		<div class="card bg-base-100 shadow-xl">
			<div class="card-body">
				<h2 class="card-title text-sm opacity-70">{$t.dashboard.heatPump}</h2>
				{#if data.isConnected && data.deviceState}
					<div class="flex items-center gap-4">
						<div>
							<p class="text-2xl font-bold">
								{data.deviceState.water_temp?.toFixed(1) ?? '--'}°C
							</p>
							<p class="text-sm opacity-70">{$t.dashboard.waterTemp}</p>
						</div>
						<div class="divider divider-horizontal"></div>
						<div>
							<p class="text-2xl font-bold text-primary">
								{data.deviceState.target_offset !== null && data.deviceState.target_offset !== undefined
									? (data.deviceState.target_offset > 0 ? '+' : '') + data.deviceState.target_offset
									: '--'}
							</p>
							<p class="text-sm opacity-70">{$t.device.setpoint}</p>
						</div>
					</div>
				{:else if !data.isConnected}
					<a href="/settings" class="btn btn-primary btn-sm">{$t.settings.connectDaikin}</a>
				{:else}
					<p class="text-lg opacity-50">{$t.consumption.noData}</p>
				{/if}
			</div>
		</div>

		<!-- Next Action Card -->
		<div class="card bg-base-100 shadow-xl">
			<div class="card-body">
				<h2 class="card-title text-sm opacity-70">{$t.dashboard.nextAction}</h2>
				{#if data.nextAction}
					<div>
						<span class="badge" class:badge-success={data.nextAction.action === 'boost'} class:badge-warning={data.nextAction.action === 'normal'} class:badge-error={data.nextAction.action === 'reduce'}>
							{translateAction(data.nextAction.action)}
						</span>
						<p class="text-2xl font-bold mt-1">
							{data.nextAction.targetTemperature}
						</p>
						<p class="text-xs opacity-70 mt-1">{data.nextAction.reason}</p>
					</div>
				{:else}
					<p class="text-lg opacity-50">--</p>
				{/if}
			</div>
		</div>
	</div>

	<!-- Device Details -->
	{#if data.isConnected && data.deviceState}
		<div class="card bg-base-100 shadow-xl">
			<div class="card-body">
				<h2 class="card-title">{$t.dashboard.heatPump}</h2>
				<DeviceStatus state={data.deviceState} />
			</div>
		</div>
	{/if}
{:else}
	<!-- Login prompt for non-authenticated users -->
	<div class="card bg-base-100 shadow-xl">
		<div class="card-body items-center text-center">
			<h2 class="card-title">{$t.dashboard.heatPump}</h2>
			<p class="opacity-70 mb-4">{$t.login.description}</p>
			<a href="/login" class="btn btn-primary">{$t.login.title}</a>
		</div>
	</div>
{/if}
