<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Chart, registerables } from 'chart.js';
	import type { HourlyConsumption } from '$lib/types';

	Chart.register(...registerables);

	let { data }: { data: HourlyConsumption[] } = $props();

	let canvas: HTMLCanvasElement;
	let chart: Chart | null = null;

	// Format 2-hour block label (e.g., "06-08")
	function formatBlockLabel(startHour: number): string {
		const endHour = (startHour + 2) % 24;
		return `${String(startHour).padStart(2, '0')}-${String(endHour).padStart(2, '0')}`;
	}

	function createChart() {
		if (!canvas || data.length === 0) return;

		// Create labels for each 2-hour block
		// Data format: hour = start hour of 2-hour block (0, 2, 4, ..., 22)
		const labels = data.map(d => {
			const date = new Date(d.timestamp + 'T00:00:00');
			const dateStr = date.toLocaleDateString('et-EE', { day: 'numeric', month: 'short' });
			return `${dateStr} ${formatBlockLabel(d.hour)}`;
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
						data: data.map(d => d.heating_kwh ?? 0),
						backgroundColor: 'rgba(99, 102, 241, 0.8)',
						borderColor: 'rgb(99, 102, 241)',
						borderWidth: 1
					},
					{
						label: 'Boiler',
						data: data.map(d => d.dhw_kwh ?? 0),
						backgroundColor: 'rgba(244, 114, 182, 0.8)',
						borderColor: 'rgb(244, 114, 182)',
						borderWidth: 1
					},
					{
						label: 'Jahutus',
						data: data.map(d => d.cooling_kwh ?? 0),
						backgroundColor: 'rgba(34, 211, 238, 0.8)',
						borderColor: 'rgb(34, 211, 238)',
						borderWidth: 1
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
							padding: 15
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
								const date = new Date(d.timestamp + 'T00:00:00');
								const endHour = (d.hour + 2) % 24;
								return date.toLocaleDateString('et-EE', {
									weekday: 'long',
									day: 'numeric',
									month: 'long'
								}) + ` kell ${d.hour}:00-${endHour}:00`;
							},
							afterBody: (items) => {
								const idx = items[0].dataIndex;
								const d = data[idx];
								const total = (d.heating_kwh ?? 0) + (d.dhw_kwh ?? 0) + (d.cooling_kwh ?? 0);
								return [``, `Kokku: ${total.toFixed(2)} kWh`];
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
							font: { size: 10 },
							maxRotation: 90,
							minRotation: 45,
							autoSkip: true,
							maxTicksLimit: 24,
							callback: function(value, index) {
								const d = data[index];
								// Show date at midnight, and time every 6 hours
								if (d.hour === 0) {
									const date = new Date(d.timestamp + 'T00:00:00');
									return date.toLocaleDateString('et-EE', { day: 'numeric', month: 'short' });
								}
								if (d.hour % 6 === 0) {
									return formatBlockLabel(d.hour);
								}
								return null;
							}
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
	<div class="h-96 w-full">
		<canvas bind:this={canvas}></canvas>
	</div>
</div>
