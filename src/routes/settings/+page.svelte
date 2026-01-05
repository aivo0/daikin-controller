<script lang="ts">
	import type { PageData, ActionData } from './$types';
	import { enhance } from '$app/forms';
	import { t } from '$lib/i18n';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<h1 class="text-2xl font-bold mb-6">{$t.settings.title}</h1>

{#if data.error}
	<div class="alert alert-error mb-4">
		<span>{data.error}</span>
	</div>
{/if}

{#if form?.success}
	<div class="alert alert-success mb-4">
		<span>{$t.settings.settingsSaved}</span>
	</div>
{/if}

{#if form?.recalculated}
	<div class="alert alert-success mb-4">
		<span>{$t.settings.scheduleRecalculated} {form.planningMessage || `(${form.hoursPlanned} ${$t.settings.hours})`}</span>
	</div>
{/if}

{#if form?.message}
	<div class="alert alert-error mb-4">
		<span>{form.message}</span>
	</div>
{/if}

<!-- Daikin Connection -->
<div class="card bg-base-100 shadow-xl mb-6">
	<div class="card-body">
		<h2 class="card-title">{$t.settings.daikinConnection}</h2>

		{#if data.isConnected}
			<div class="flex items-center gap-2">
				<span class="badge badge-success">{$t.settings.connected}</span>
				<span class="text-sm opacity-70">{$t.settings.daikinConnected}</span>
			</div>
		{:else}
			<p class="text-sm opacity-70 mb-4">
				{$t.settings.daikinDescription}
			</p>

			{#if data.authUrl}
				<a href={data.authUrl} class="btn btn-primary">{$t.settings.connectDaikin}</a>
			{:else}
				<div class="alert alert-warning">
					<span>{$t.settings.daikinMissing}</span>
				</div>
			{/if}
		{/if}
	</div>
</div>

{#if data.settings}
	<form method="POST" action="?/updateSettings" use:enhance>
		<!-- Heating Algorithm Settings -->
		<div class="card bg-base-100 shadow-xl mb-6">
			<div class="card-body">
				<h2 class="card-title">{$t.settings.heatingAlgorithm}</h2>
				<p class="text-sm opacity-70 mb-4">
					{$t.settings.algorithmDescription}
				</p>

				<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
					<div class="form-control">
						<label class="label" for="price_sensitivity">
							<span class="label-text">{$t.settings.priceSensitivity}</span>
						</label>
						<input
							type="range"
							id="price_sensitivity"
							name="price_sensitivity"
							value={data.settings.price_sensitivity}
							min="1"
							max="10"
							step="1"
							class="range range-primary"
						/>
						<div class="flex justify-between text-xs px-2 mt-1">
							<span>1</span>
							<span>5</span>
							<span>10</span>
						</div>
						<span class="label-text-alt mt-1">
							{$t.settings.current}: <strong>{data.settings.price_sensitivity}</strong> —
							{$t.settings.priceSensitivityHelp}
						</span>
					</div>

					<div class="form-control">
						<label class="label" for="cold_weather_threshold">
							<span class="label-text">{$t.settings.coldWeatherThreshold}</span>
						</label>
						<input
							type="number"
							id="cold_weather_threshold"
							name="cold_weather_threshold"
							value={data.settings.cold_weather_threshold}
							min="-20"
							max="5"
							step="1"
							class="input input-bordered"
						/>
						<span class="label-text-alt mt-1">
							{$t.settings.coldWeatherHelp}
						</span>
					</div>

					<div class="form-control">
						<label class="label" for="planning_hour">
							<span class="label-text">{$t.settings.planningHour}</span>
						</label>
						<select
							id="planning_hour"
							name="planning_hour"
							class="select select-bordered"
						>
							{#each [13, 14, 15, 16, 17] as hour}
								<option value={hour} selected={data.settings.planning_hour === hour}>
									{hour}:00
								</option>
							{/each}
						</select>
						<span class="label-text-alt mt-1">
							{$t.settings.planningHourHelp}
						</span>
					</div>

					<div class="form-control">
						<label class="label" for="low_price_threshold">
							<span class="label-text">{$t.settings.lowPriceThreshold}</span>
						</label>
						<input
							type="number"
							id="low_price_threshold"
							name="low_price_threshold"
							value={data.settings.low_price_threshold}
							min="0"
							max="20"
							step="0.5"
							class="input input-bordered"
						/>
						<span class="label-text-alt mt-1">
							{$t.settings.lowPriceHelp}
						</span>
					</div>
				</div>
			</div>
		</div>

		<!-- DHW (Boiler) Settings -->
		<div class="card bg-base-100 shadow-xl mb-6">
			<div class="card-body">
				<h2 class="card-title">{$t.settings.boilerSettings}</h2>

				<div class="form-control mb-4">
					<label class="label cursor-pointer justify-start gap-4">
						<input
							type="checkbox"
							name="dhw_enabled"
							checked={data.settings.dhw_enabled}
							class="checkbox checkbox-primary"
						/>
						<div>
							<span class="label-text font-medium">{$t.settings.boilerEnabled}</span>
							<p class="text-sm opacity-70">{$t.settings.boilerEnabledHelp}</p>
						</div>
					</label>
				</div>

				<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
					<div class="form-control">
						<label class="label" for="dhw_min_temp">
							<span class="label-text">{$t.settings.boilerMinTemp}</span>
						</label>
						<input
							type="number"
							id="dhw_min_temp"
							name="dhw_min_temp"
							value={data.settings.dhw_min_temp}
							min="30"
							max="50"
							step="1"
							class="input input-bordered"
						/>
						<span class="label-text-alt mt-1">{$t.settings.boilerMinTempHelp}</span>
					</div>

					<div class="form-control">
						<label class="label" for="dhw_target_temp">
							<span class="label-text">{$t.settings.boilerMaxTemp}</span>
						</label>
						<input
							type="number"
							id="dhw_target_temp"
							name="dhw_target_temp"
							value={data.settings.dhw_target_temp}
							min="40"
							max="60"
							step="1"
							class="input input-bordered"
						/>
						<span class="label-text-alt mt-1">{$t.settings.boilerMaxTempHelp}</span>
					</div>
				</div>
			</div>
		</div>

		<!-- Location Settings -->
		<div class="card bg-base-100 shadow-xl mb-6">
			<div class="card-body">
				<h2 class="card-title">{$t.settings.location}</h2>
				<p class="text-sm opacity-70 mb-4">
					{$t.settings.locationDescription}
				</p>

				<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
					<div class="form-control">
						<label class="label" for="weather_location_lat">
							<span class="label-text">{$t.settings.latitude}</span>
						</label>
						<input
							type="number"
							id="weather_location_lat"
							name="weather_location_lat"
							value={data.settings.weather_location_lat}
							min="-90"
							max="90"
							step="0.0001"
							class="input input-bordered"
							placeholder="59.3"
						/>
						<span class="label-text-alt mt-1">{$t.settings.latitudeHelp}</span>
					</div>

					<div class="form-control">
						<label class="label" for="weather_location_lon">
							<span class="label-text">{$t.settings.longitude}</span>
						</label>
						<input
							type="number"
							id="weather_location_lon"
							name="weather_location_lon"
							value={data.settings.weather_location_lon}
							min="-180"
							max="180"
							step="0.0001"
							class="input input-bordered"
							placeholder="24.7"
						/>
						<span class="label-text-alt mt-1">{$t.settings.longitudeHelp}</span>
					</div>
				</div>
			</div>
		</div>

		<!-- Algorithm Info -->
		<div class="card bg-base-200 shadow-xl mb-6">
			<div class="card-body">
				<h2 class="card-title text-base">{$t.settings.howItWorks}</h2>
				<ul class="text-sm space-y-2 list-disc list-inside opacity-80">
					<li><strong>{$t.settings.dailyPlanning}:</strong> {data.settings.planning_hour}:00 {$t.settings.dailyPlanningDesc}</li>
					<li><strong>{$t.settings.guarantee}:</strong> {$t.settings.guaranteeDesc}</li>
					<li><strong>{$t.settings.priceOffset}:</strong> {$t.settings.priceOffsetDesc}</li>
					<li><strong>{$t.settings.coldProtection}:</strong> {data.settings.cold_weather_threshold}°C {$t.settings.coldProtectionDesc}</li>
					<li><strong>{$t.settings.weatherForecast}:</strong> {$t.settings.weatherForecastDesc}</li>
				</ul>
			</div>
		</div>

		<div class="flex justify-end">
			<button type="submit" class="btn btn-primary">{$t.settings.save}</button>
		</div>
	</form>

	<!-- Manual Recalculation -->
	<div class="card bg-base-100 shadow-xl mb-6">
		<div class="card-body">
			<h2 class="card-title">{$t.settings.manualRecalc}</h2>
			<p class="text-sm opacity-70 mb-4">
				{$t.settings.manualRecalcDesc}
			</p>
			<form method="POST" action="?/recalculate" use:enhance>
				<button type="submit" class="btn btn-secondary">
					{$t.settings.recalcButton}
				</button>
			</form>
		</div>
	</div>
{/if}
