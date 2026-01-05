<script lang="ts">
	import type { DeviceState } from '$lib/types';
	import { t } from '$lib/i18n';

	let { state }: { state: DeviceState } = $props();

	function translateMode(mode: string): string {
		const key = mode.toLowerCase() as keyof typeof $t.modes;
		return $t.modes[key] || mode;
	}

	function translateAction(action: string | undefined): string {
		if (!action) return '--';
		const key = action.toLowerCase() as keyof typeof $t.actions;
		return $t.actions[key] || action.toUpperCase();
	}
</script>

<div class="text-sm mb-4">
	<span class="opacity-70">{$t.device.deviceId}:</span>
	<span class="font-mono">{state.device_id}</span>
</div>

<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
	<!-- Heating Section -->
	<div class="overflow-x-auto">
		<div class="text-sm font-semibold opacity-70 mb-2">{$t.device.heating}</div>
		<table class="table table-zebra table-sm">
			<tbody>
				<tr>
					<td class="font-medium">{$t.common.on}/{$t.common.off}</td>
					<td>
						{#if state.power_on}
							<span class="badge badge-success badge-sm">{$t.device.powerOn}</span>
						{:else}
							<span class="badge badge-ghost badge-sm">{$t.device.powerOff}</span>
						{/if}
					</td>
				</tr>
				<tr>
					<td class="font-medium">{$t.dashboard.waterTemp}</td>
					<td>{state.water_temp !== null ? `${state.water_temp.toFixed(1)}°C` : '--'}</td>
				</tr>
				<tr>
					<td class="font-medium">{$t.device.outdoorTemp}</td>
					<td>{state.outdoor_temp !== null ? `${state.outdoor_temp.toFixed(1)}°C` : '--'}</td>
				</tr>
				<tr>
					<td class="font-medium">{$t.device.setpoint}</td>
					<td class="text-primary font-bold">
						{state.target_offset !== null ? `${state.target_offset > 0 ? '+' : ''}${state.target_offset}°C` : '--'}
					</td>
				</tr>
				<tr>
					<td class="font-medium">{$t.device.mode}</td>
					<td>
						{#if state.mode}
							<span class="badge badge-outline badge-sm">{translateMode(state.mode)}</span>
						{:else}
							--
						{/if}
					</td>
				</tr>
			</tbody>
		</table>
	</div>

	<!-- DHW (Boiler) Section -->
	{#if state.dhw_tank_temp !== undefined && state.dhw_tank_temp !== null}
		<div class="overflow-x-auto">
			<div class="text-sm font-semibold opacity-70 mb-2">{$t.device.boiler}</div>
			<table class="table table-zebra table-sm">
				<tbody>
					<tr>
						<td class="font-medium">{$t.device.tankTemp}</td>
						<td>{state.dhw_tank_temp.toFixed(1)}°C</td>
					</tr>
					<tr>
						<td class="font-medium">{$t.device.tankSetpoint}</td>
						<td class="text-primary font-bold">
							{state.dhw_target_temp !== null && state.dhw_target_temp !== undefined ? `${state.dhw_target_temp}°C` : '--'}
						</td>
					</tr>
					<tr>
						<td class="font-medium">{$t.history.action}</td>
						<td>
							{#if state.dhw_action === 'boost'}
								<span class="badge badge-success badge-sm">{translateAction(state.dhw_action)}</span>
							{:else if state.dhw_action === 'reduce'}
								<span class="badge badge-warning badge-sm">{translateAction(state.dhw_action)}</span>
							{:else}
								<span class="badge badge-ghost badge-sm">{translateAction(state.dhw_action)}</span>
							{/if}
						</td>
					</tr>
				</tbody>
			</table>
		</div>
	{/if}
</div>
