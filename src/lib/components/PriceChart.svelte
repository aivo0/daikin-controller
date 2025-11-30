<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Chart, registerables } from 'chart.js';
	import type { HourlyPrice } from '$lib/types';

	Chart.register(...registerables);

	let { prices }: { prices: HourlyPrice[] } = $props();

	let canvas: HTMLCanvasElement;
	let chart: Chart | null = null;

	// Aggregate 15-min prices to hourly (take average) and filter to today + tomorrow only
	const hourlyPrices = $derived(() => {
		const hourMap = new Map<string, { prices: number[]; data: HourlyPrice }>();

		// Calculate today's start and end of tomorrow
		const now = new Date();
		const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
		const tomorrowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2).getTime();

		for (const p of prices) {
			const date = new Date(p.timestamp);
			const dateTime = date.getTime();

			// Only include today and tomorrow
			if (dateTime < todayStart || dateTime >= tomorrowEnd) continue;

			const hourKey = new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()).toISOString();

			if (!hourMap.has(hourKey)) {
				hourMap.set(hourKey, { prices: [], data: { ...p, timestamp: hourKey } });
			}
			hourMap.get(hourKey)!.prices.push(p.price);
		}

		return Array.from(hourMap.values())
			.map(({ prices: priceList, data }) => ({
				...data,
				price: priceList.reduce((a, b) => a + b, 0) / priceList.length
			}))
			.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
	});

	// Calculate stats
	const stats = $derived(() => {
		const priceValues = hourlyPrices().map(p => p.price);
		const avg = priceValues.reduce((a, b) => a + b, 0) / priceValues.length;
		const min = Math.min(...priceValues);
		const max = Math.max(...priceValues);
		return { avg, min, max };
	});

	// Get current hour index for marker
	const currentHourIndex = $derived(() => {
		const now = new Date();
		const currentHourStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours()).getTime();
		return hourlyPrices().findIndex(p => new Date(p.timestamp).getTime() === currentHourStart);
	});

	// Get day labels for bottom of chart
	const dayLabels = $derived(() => {
		const result: { date: Date; count: number }[] = [];
		let lastDate = '';
		for (const price of hourlyPrices()) {
			const d = new Date(price.timestamp);
			const dateStr = d.toDateString();
			if (dateStr !== lastDate) {
				result.push({ date: d, count: 1 });
				lastDate = dateStr;
			} else if (result.length > 0) {
				result[result.length - 1].count++;
			}
		}
		return result;
	});

	function getPointColors(prices: HourlyPrice[]): string[] {
		return prices.map(p => {
			if (p.isCheap) return 'rgb(0, 200, 83)'; // green
			if (p.isExpensive) return 'rgb(255, 82, 82)'; // red
			return 'rgb(99, 102, 241)'; // indigo/primary
		});
	}

	function getSegmentColor(ctx: { p0DataIndex: number }, prices: HourlyPrice[]): string {
		const price = prices[ctx.p0DataIndex];
		if (price?.isCheap) return 'rgb(0, 200, 83)';
		if (price?.isExpensive) return 'rgb(255, 82, 82)';
		return 'rgb(99, 102, 241)';
	}

	function createChart() {
		if (!canvas || hourlyPrices().length === 0) return;

		const priceData = hourlyPrices();
		const labels = priceData.map(p => {
			const date = new Date(p.timestamp);
			return date.getHours().toString().padStart(2, '0');
		});

		// Find day boundaries for vertical lines
		const dayBoundaries: number[] = [];
		let lastDate = '';
		priceData.forEach((p, i) => {
			const dateStr = new Date(p.timestamp).toDateString();
			if (dateStr !== lastDate && i > 0) {
				dayBoundaries.push(i);
			}
			lastDate = dateStr;
		});

		if (chart) {
			chart.destroy();
		}

		const ctx = canvas.getContext('2d')!;

		chart = new Chart(ctx, {
			type: 'line',
			data: {
				labels,
				datasets: [{
					data: priceData.map(p => p.price),
					borderWidth: 2,
					pointRadius: 0,
					pointHoverRadius: 6,
					pointHoverBackgroundColor: getPointColors(priceData),
					tension: 0.1,
					fill: true,
					backgroundColor: 'rgba(99, 102, 241, 0.1)',
					segment: {
						borderColor: (ctx) => getSegmentColor(ctx, priceData)
					}
				}]
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
						display: false
					},
					tooltip: {
						backgroundColor: 'rgba(0, 0, 0, 0.8)',
						titleFont: { size: 14 },
						bodyFont: { size: 13 },
						padding: 12,
						callbacks: {
							title: (items) => {
								const idx = items[0].dataIndex;
								const price = priceData[idx];
								const date = new Date(price.timestamp);
								return date.toLocaleDateString('et-EE', {
									weekday: 'short',
									day: 'numeric',
									month: 'short'
								}) + ' ' + date.getHours() + ':00';
							},
							label: (item) => {
								const price = item.raw as number;
								return `${price.toFixed(2)} senti/kWh`;
							}
						}
					}
				},
				scales: {
					x: {
						display: true,
						grid: {
							display: true,
							color: (ctx) => {
								if (dayBoundaries.includes(ctx.index)) {
									return 'rgba(255, 255, 255, 0.4)';
								}
								return 'rgba(255, 255, 255, 0.05)';
							},
							lineWidth: (ctx) => dayBoundaries.includes(ctx.index) ? 2 : 1
						},
						ticks: {
							display: true,
							color: '#a1a1aa',
							font: { size: 12, weight: 500 },
							maxRotation: 0,
							autoSkip: false,
							callback: function(value, index) {
								const hour = parseInt(labels[index]);
								if (hour % 6 === 0) {
									return labels[index] + ':00';
								}
								return null;
							}
						}
					},
					y: {
						display: true,
						beginAtZero: true,
						grid: {
							display: true,
							color: 'rgba(255, 255, 255, 0.1)'
						},
						ticks: {
							display: true,
							color: '#a1a1aa',
							font: { size: 12, weight: 500 },
							callback: (value) => value + ' s/kWh'
						}
					}
				}
			},
			plugins: [{
				id: 'currentTimeMarker',
				afterDraw: (chart) => {
					const idx = currentHourIndex();
					if (idx < 0) return;

					const xScale = chart.scales.x;
					const yScale = chart.scales.y;
					const x = xScale.getPixelForValue(idx);

					const ctx = chart.ctx;
					ctx.save();
					ctx.beginPath();
					ctx.setLineDash([5, 5]);
					ctx.strokeStyle = 'rgba(255, 193, 7, 0.8)';
					ctx.lineWidth = 2;
					ctx.moveTo(x, yScale.top);
					ctx.lineTo(x, yScale.bottom);
					ctx.stroke();
					ctx.restore();

					// Draw "NOW" label
					ctx.save();
					ctx.fillStyle = 'rgba(255, 193, 7, 0.9)';
					ctx.font = 'bold 10px sans-serif';
					ctx.textAlign = 'center';
					ctx.fillText('PRAEGU', x, yScale.top - 5);
					ctx.restore();
				}
			}]
		});
	}

	$effect(() => {
		// Reactively update chart when prices change
		hourlyPrices();
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
	<!-- Stats bar -->
	<div class="flex justify-between text-sm mb-4 px-2">
		<div class="flex gap-4">
			<span class="opacity-70">Min: <span class="text-success font-medium">{stats().min.toFixed(1)} s</span></span>
			<span class="opacity-70">Kesk: <span class="font-medium">{stats().avg.toFixed(1)} s</span></span>
			<span class="opacity-70">Max: <span class="text-error font-medium">{stats().max.toFixed(1)} s</span></span>
		</div>
		<div class="flex gap-4">
			<div class="flex items-center gap-1">
				<div class="w-3 h-0.5 bg-success"></div>
				<span class="opacity-70">Odav</span>
			</div>
			<div class="flex items-center gap-1">
				<div class="w-3 h-0.5 bg-error"></div>
				<span class="opacity-70">Kallis</span>
			</div>
			<div class="flex items-center gap-1">
				<div class="w-3 h-0.5 bg-warning border-dashed"></div>
				<span class="opacity-70">Praegu</span>
			</div>
		</div>
	</div>

	<!-- Chart container -->
	<div class="h-72 w-full">
		<canvas bind:this={canvas}></canvas>
	</div>

	<!-- Day labels -->
	<div class="flex mt-1 text-sm">
		{#each dayLabels() as day}
			<div class="text-center opacity-70" style="flex: {day.count}">
				{day.date.toLocaleDateString('et-EE', { weekday: 'short', day: 'numeric', month: 'short' })}
			</div>
		{/each}
	</div>
</div>
