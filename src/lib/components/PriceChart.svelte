<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Chart, registerables } from 'chart.js';
	import type { HourlyPrice, PlannedHeatingHour } from '$lib/types';

	Chart.register(...registerables);

	interface HeatingScheduleWithDate extends PlannedHeatingHour {
		date: string;
	}

	let { prices, heatingSchedule = [] }: { prices: HourlyPrice[]; heatingSchedule?: HeatingScheduleWithDate[] } = $props();

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

	// Create offset lookup map: "YYYY-MM-DD-HH" -> offset
	const offsetMap = $derived(() => {
		const map = new Map<string, number>();
		for (const h of heatingSchedule) {
			const key = `${h.date}-${h.hour.toString().padStart(2, '0')}`;
			map.set(key, h.planned_offset);
		}
		return map;
	});

	// Check if we have heating schedule data
	const hasHeatingSchedule = $derived(() => heatingSchedule.length > 0);

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

		// Build offset data array matching price data
		// IMPORTANT: Use UTC hours since the server stores schedules with UTC hours
		const offsets = offsetMap();
		const offsetData = priceData.map(p => {
			const date = new Date(p.timestamp);
			const dateStr = date.toISOString().split('T')[0];
			const hourStr = date.getUTCHours().toString().padStart(2, '0');
			const key = `${dateStr}-${hourStr}`;
			return offsets.get(key) ?? null;
		});

		if (chart) {
			chart.destroy();
		}

		const ctx = canvas.getContext('2d')!;

		// Build datasets
		const datasets: any[] = [{
			label: 'Hind',
			data: priceData.map(p => p.price),
			borderWidth: 2,
			pointRadius: 0,
			pointHoverRadius: 6,
			pointHoverBackgroundColor: getPointColors(priceData),
			tension: 0.1,
			fill: true,
			backgroundColor: 'rgba(99, 102, 241, 0.1)',
			segment: {
				borderColor: (ctx: any) => getSegmentColor(ctx, priceData)
			},
			yAxisID: 'y'
		}];

		// Add offset dataset if we have data
		if (hasHeatingSchedule()) {
			datasets.push({
				label: 'Kütte nihe',
				data: offsetData,
				borderWidth: 2,
				borderColor: 'rgba(251, 146, 60, 0.9)',
				backgroundColor: 'rgba(251, 146, 60, 0.2)',
				pointRadius: 3,
				pointBackgroundColor: (ctx: any) => {
					const value = ctx.raw as number | null;
					if (value === null) return 'transparent';
					if (value > 0) return 'rgb(74, 222, 128)';
					if (value < 0) return 'rgb(248, 113, 113)';
					return 'rgb(251, 146, 60)';
				},
				pointBorderColor: 'transparent',
				tension: 0,
				stepped: 'middle',
				fill: false,
				yAxisID: 'y1'
			});
		}

		chart = new Chart(ctx, {
			type: 'line',
			data: {
				labels,
				datasets
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
						display: hasHeatingSchedule(),
						position: 'top',
						align: 'end',
						labels: {
							boxWidth: 12,
							boxHeight: 2,
							color: '#a1a1aa',
							font: { size: 11 },
							usePointStyle: false
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
								const price = priceData[idx];
								const date = new Date(price.timestamp);
								return date.toLocaleDateString('et-EE', {
									weekday: 'short',
									day: 'numeric',
									month: 'short'
								}) + ' ' + date.getHours() + ':00';
							},
							label: (item) => {
								if (item.datasetIndex === 0) {
									const price = item.raw as number;
									return `Hind: ${price.toFixed(2)} s/kWh`;
								} else {
									const offset = item.raw as number | null;
									if (offset === null) return '';
									const sign = offset > 0 ? '+' : '';
									return `Kütte nihe: ${sign}${offset}`;
								}
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
						type: 'linear',
						display: true,
						position: 'left',
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
					},
					y1: {
						type: 'linear',
						display: hasHeatingSchedule(),
						position: 'right',
						min: -10,
						max: 10,
						reverse: true,
						grid: {
							display: false
						},
						ticks: {
							display: true,
							color: 'rgba(251, 146, 60, 0.8)',
							font: { size: 11, weight: 500 },
							stepSize: 5,
							callback: (value) => {
								if (value === 0) return '0';
								return (value > 0 ? '+' : '') + value;
							}
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
		// Reactively update chart when prices or schedule change
		hourlyPrices();
		offsetMap();
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
		<div class="flex gap-4 flex-wrap">
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
			{#if hasHeatingSchedule()}
				<div class="flex items-center gap-1">
					<div class="w-3 h-0.5" style="background-color: rgb(251, 146, 60);"></div>
					<span class="opacity-70">Kütte nihe</span>
				</div>
			{/if}
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
