<script lang="ts">
	import type { DeviceState } from '$lib/types';

	let { state }: { state: DeviceState } = $props();

	function translateMode(mode: string): string {
		const translations: Record<string, string> = {
			heating: 'Küte',
			cooling: 'Jahutus',
			auto: 'Automaatne',
			off: 'Väljas',
			fan: 'Ventilaator',
			dry: 'Kuivatamine'
		};
		return translations[mode.toLowerCase()] || mode;
	}

	function translateAction(action: string | undefined): string {
		if (!action) return '--';
		const translations: Record<string, string> = {
			boost: 'TÕSTMINE',
			reduce: 'VÄHENDAMINE',
			normal: 'TAVALINE',
			none: 'MUUTUST POLE'
		};
		return translations[action.toLowerCase()] || action.toUpperCase();
	}
</script>

<div class="overflow-x-auto">
	<table class="table table-zebra">
		<tbody>
			<tr>
				<td class="font-medium">Seadme ID</td>
				<td class="font-mono text-sm">{state.device_id}</td>
			</tr>
			<tr>
				<td class="font-medium">Olek</td>
				<td>
					{#if state.power_on}
						<span class="badge badge-success">SEES</span>
					{:else}
						<span class="badge badge-ghost">VÄLJAS</span>
					{/if}
				</td>
			</tr>
			<tr>
				<td class="font-medium">Vee temperatuur</td>
				<td>{state.water_temp !== null ? `${state.water_temp.toFixed(1)}°C` : '--'}</td>
			</tr>
			<tr>
				<td class="font-medium">Välistemperatuur</td>
				<td>{state.outdoor_temp !== null ? `${state.outdoor_temp.toFixed(1)}°C` : '--'}</td>
			</tr>
			<tr>
				<td class="font-medium">Temperatuuri nihe</td>
				<td class="text-primary font-bold">
					{state.target_offset !== null ? `${state.target_offset > 0 ? '+' : ''}${state.target_offset}°C` : '--'}
				</td>
			</tr>
			<tr>
				<td class="font-medium">Režiim</td>
				<td>
					{#if state.mode}
						<span class="badge badge-outline">{translateMode(state.mode)}</span>
					{:else}
						--
					{/if}
				</td>
			</tr>
		</tbody>
	</table>

	<!-- DHW (Boiler) Section -->
	{#if state.dhw_tank_temp !== undefined && state.dhw_tank_temp !== null}
		<div class="divider">Boiler (sooja vee)</div>
		<table class="table table-zebra">
			<tbody>
				<tr>
					<td class="font-medium">Boileri temperatuur</td>
					<td class="text-lg">{state.dhw_tank_temp.toFixed(1)}°C</td>
				</tr>
				<tr>
					<td class="font-medium">Sihttemperatuur</td>
					<td class="text-primary font-bold">
						{state.dhw_target_temp !== null && state.dhw_target_temp !== undefined ? `${state.dhw_target_temp}°C` : '--'}
					</td>
				</tr>
				<tr>
					<td class="font-medium">Tegevus</td>
					<td>
						{#if state.dhw_action === 'boost'}
							<span class="badge badge-success">{translateAction(state.dhw_action)}</span>
						{:else if state.dhw_action === 'reduce'}
							<span class="badge badge-warning">{translateAction(state.dhw_action)}</span>
						{:else}
							<span class="badge badge-ghost">{translateAction(state.dhw_action)}</span>
						{/if}
					</td>
				</tr>
			</tbody>
		</table>
	{/if}
</div>
