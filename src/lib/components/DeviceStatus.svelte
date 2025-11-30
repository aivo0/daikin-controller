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
</div>
