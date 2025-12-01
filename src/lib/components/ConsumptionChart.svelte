<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Chart, registerables } from 'chart.js';

	Chart.register(...registerables);

	interface DailyConsumption {
		date: string;
		heating_kwh: number;
		cooling_kwh: number;
		dhw_kwh: number;
		total_kwh: number;
		avg_price: number;
		estimated_cost: number;
	}

	let { data }: { data: DailyConsumption[] } = $props();

	let canvas: HTMLCanvasElement;
	let chart: Chart | null = null;

	function createChart() {
		if (!canvas || data.length === 0) return;

		const labels = data.map(d => {
			const date = new Date(d.date);
			return date.toLocaleDateString('et-EE', { day: 'numeric', month: 'short' });
		});

		if (chart) {
			chart.destroy();
		}

		const ctx = canvas.getContext('2d')!;

		chart = new Chart(ctx, {
			type: 'bar',
			data: {
				labels,
				datasets: [
					{
						label: 'Küte',
						data: data.map(d => d.heating_kwh),
						backgroundColor: 'rgba(99, 102, 241, 0.8)',
						borderColor: 'rgb(99, 102, 241)',
						borderWidth: 1,
						borderRadius: 2
					},
					{
						label: 'Boiler',
						data: data.map(d => d.dhw_kwh),
						backgroundColor: 'rgba(244, 114, 182, 0.8)',
						borderColor: 'rgb(244, 114, 182)',
						borderWidth: 1,
						borderRadius: 2
					},
					{
						label: 'Jahutus',
						data: data.map(d => d.cooling_kwh),
						backgroundColor: 'rgba(34, 211, 238, 0.8)',
						borderColor: 'rgb(34, 211, 238)',
						borderWidth: 1,
						borderRadius: 2
					}
				]
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				interaction: {
					intersect: false,
					mode: 'index'
				},
				plugins: {
					legend: {
						display: true,
						position: 'top',
						labels: {
							color: '#a1a1aa',
							usePointStyle: true,
							padding: 20
						}
					},
					tooltip: {
						backgroundColor: 'rgba(0, 0, 0, 0.8)',
						titleFont: { size: 14 },
						bodyFont: { size: 13 },
						padding: 12,
						callbacks: {
							title: (items) => {
								const idx = items[0].dataIndex;
								const d = data[idx];
								const date = new Date(d.date);
								return date.toLocaleDateString('et-EE', {
									weekday: 'long',
									day: 'numeric',
									month: 'long'
								});
							},
							afterBody: (items) => {
								const idx = items[0].dataIndex;
								const d = data[idx];
								return [
									'',
									`Kokku: ${d.total_kwh.toFixed(1)} kWh`,
									`Kesk. hind: ${d.avg_price.toFixed(1)} s/kWh`,
									`Kulu: ${(d.estimated_cost / 100).toFixed(2)} EUR`
								];
							}
						}
					}
				},
				scales: {
					x: {
						stacked: true,
						display: true,
						grid: {
							display: false
						},
						ticks: {
							display: true,
							color: '#a1a1aa',
							font: { size: 11 },
							maxRotation: 45,
							minRotation: 45
						}
					},
					y: {
						stacked: true,
						display: true,
						beginAtZero: true,
						grid: {
							display: true,
							color: 'rgba(255, 255, 255, 0.1)'
						},
						ticks: {
							display: true,
							color: '#a1a1aa',
							font: { size: 12 },
							callback: (value) => value + ' kWh'
						}
					}
				}
			}
		});
	}

	$effect(() => {
		// Reactively update chart when data changes
		data;
		if (canvas) {
			createChart();
		}
	});

	onMount(() => {
		createChart();
	});

	onDestroy(() => {
		if (chart) {
			chart.destroy();
		}
	});
</script>

<div class="w-full">
	<!-- Legend description -->
	<div class="flex justify-end gap-4 text-sm mb-2 px-2">
		<div class="flex items-center gap-1">
			<div class="w-3 h-3 rounded-sm" style="background: rgba(99, 102, 241, 0.8)"></div>
			<span class="opacity-70">Küte</span>
		</div>
		<div class="flex items-center gap-1">
			<div class="w-3 h-3 rounded-sm" style="background: rgba(244, 114, 182, 0.8)"></div>
			<span class="opacity-70">Boiler</span>
		</div>
		<div class="flex items-center gap-1">
			<div class="w-3 h-3 rounded-sm" style="background: rgba(34, 211, 238, 0.8)"></div>
			<span class="opacity-70">Jahutus</span>
		</div>
	</div>

	<!-- Chart container -->
	<div class="h-80 w-full">
		<canvas bind:this={canvas}></canvas>
	</div>
</div>
