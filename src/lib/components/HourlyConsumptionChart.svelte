<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Chart, registerables } from 'chart.js';
	import type { HourlyConsumption } from '$lib/types';

	Chart.register(...registerables);

	let { data }: { data: HourlyConsumption[] } = $props();

	let canvas: HTMLCanvasElement;
	let chart: Chart | null = null;

	// Convert UTC hour to local Date object
	function toLocalDate(d: HourlyConsumption): Date {
		// Create UTC timestamp from date string and hour
		const utcDate = new Date(`${d.timestamp}T${String(d.hour).padStart(2, '0')}:00:00Z`);
		return utcDate;
	}

	function createChart() {
		if (!canvas || data.length === 0) return;

		// Create labels for each hour (date + hour) in local time
		const labels = data.map(d => {
			const localDate = toLocalDate(d);
			return localDate.toLocaleString('et-EE', {
				day: 'numeric',
				month: 'short',
				hour: '2-digit',
				minute: '2-digit'
			});
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
								const localDate = toLocalDate(d);
								return localDate.toLocaleDateString('et-EE', {
									weekday: 'long',
									day: 'numeric',
									month: 'long'
								}) + ` kell ${localDate.getHours()}:00`;
							},
							afterBody: (items) => {
								const idx = items[0].dataIndex;
								const d = data[idx];
								const total = (d.heating_kwh ?? 0) + (d.dhw_kwh ?? 0) + (d.cooling_kwh ?? 0);
								return [``, `Kokku: ${total.toFixed(1)} kWh`];
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
								// Show only every 6th hour or day boundaries (in local time)
								const d = data[index];
								const localDate = toLocalDate(d);
								const localHour = localDate.getHours();
								if (localHour === 0) {
									return localDate.toLocaleDateString('et-EE', { day: 'numeric', month: 'short' });
								}
								if (localHour % 6 === 0) {
									return `${localHour}:00`;
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
