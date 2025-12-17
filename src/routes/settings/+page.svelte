<script lang="ts">
	import type { PageData, ActionData } from './$types';
	import { enhance } from '$app/forms';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<h1 class="text-2xl font-bold mb-6">Seaded</h1>

{#if data.error}
	<div class="alert alert-error mb-4">
		<span>{data.error}</span>
	</div>
{/if}

{#if form?.success}
	<div class="alert alert-success mb-4">
		<span>Seaded salvestatud!</span>
	</div>
{/if}

{#if form?.recalculated}
	<div class="alert alert-success mb-4">
		<span>Graafik ümberarvutatud! {form.planningMessage || `(${form.hoursPlanned} tundi)`}</span>
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
		<h2 class="card-title">Daikini ühendus</h2>

		{#if data.isConnected}
			<div class="flex items-center gap-2">
				<span class="badge badge-success">Ühendatud</span>
				<span class="text-sm opacity-70">Teie Daikini konto on seotud</span>
			</div>
		{:else}
			<p class="text-sm opacity-70 mb-4">
				Ühendage oma Daikini konto, et lubada automaatne soojuspumba juhtimine.
			</p>

			{#if data.authUrl}
				<a href={data.authUrl} class="btn btn-primary">Ühenda Daikini konto</a>
			{:else}
				<div class="alert alert-warning">
					<span>Daikini API andmed puuduvad. Palun seadista DAIKIN_CLIENT_ID ja DAIKIN_CLIENT_SECRET.</span>
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
				<h2 class="card-title">Kütmise algoritm</h2>
				<p class="text-sm opacity-70 mb-4">
					Algoritm planeerib iga päev kell 15:00 järgmise päeva küttegraafiku,
					kasutades elektrihindu ja ilmaprognoosi.
				</p>

				<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
					<div class="form-control">
						<label class="label" for="price_sensitivity">
							<span class="label-text">Hinnatundlikkus (K)</span>
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
							Praegune: <strong>{data.settings.price_sensitivity}</strong> —
							Kõrgem väärtus = suurem hinnaerinevuste mõju temperatuurile
						</span>
					</div>

					<div class="form-control">
						<label class="label" for="cold_weather_threshold">
							<span class="label-text">Külma ilma lävi (°C)</span>
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
							Alla selle temperatuuri vähendatakse kallite tundide karistust
						</span>
					</div>

					<div class="form-control">
						<label class="label" for="planning_hour">
							<span class="label-text">Planeerimise kellaaeg</span>
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
							Järgmise päeva plaan arvutatakse sellel kellaajal (homse hinnad saadaval ~14:00)
						</span>
					</div>

					<div class="form-control">
						<label class="label" for="low_price_threshold">
							<span class="label-text">Madala hinna piir (s/kWh)</span>
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
							Kasutatakse ainult varustrateegiana kui plaan puudub
						</span>
					</div>
				</div>
			</div>
		</div>

		<!-- DHW (Boiler) Settings -->
		<div class="card bg-base-100 shadow-xl mb-6">
			<div class="card-body">
				<h2 class="card-title">Boileri (sooja vee) seaded</h2>

				<div class="form-control mb-4">
					<label class="label cursor-pointer justify-start gap-4">
						<input
							type="checkbox"
							name="dhw_enabled"
							checked={data.settings.dhw_enabled}
							class="checkbox checkbox-primary"
						/>
						<div>
							<span class="label-text font-medium">Boileri juhtimine sisse lülitatud</span>
							<p class="text-sm opacity-70">Luba sooja vee boileri automaatne juhtimine hinna põhjal</p>
						</div>
					</label>
				</div>

				<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
					<div class="form-control">
						<label class="label" for="dhw_min_temp">
							<span class="label-text">Miinimum temperatuur (°C)</span>
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
						<span class="label-text-alt mt-1">Boileri temperatuur ei lange alla selle kallitel tundidel</span>
					</div>

					<div class="form-control">
						<label class="label" for="dhw_target_temp">
							<span class="label-text">Maksimum temperatuur (°C)</span>
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
						<span class="label-text-alt mt-1">Soojendamise sihttemperatuur odavatel tundidel</span>
					</div>
				</div>
			</div>
		</div>

		<!-- Algorithm Info -->
		<div class="card bg-base-200 shadow-xl mb-6">
			<div class="card-body">
				<h2 class="card-title text-base">Kuidas algoritm töötab</h2>
				<ul class="text-sm space-y-2 list-disc list-inside opacity-80">
					<li><strong>Igapäevane planeerimine:</strong> Kell {data.settings.planning_hour}:00 arvutatakse järgmise päeva graafik</li>
					<li><strong>50% garantii:</strong> Vähemalt pooltel tundidel on kütmine normaalsel või kõrgemal tasemel</li>
					<li><strong>Hinnapõhine nihe:</strong> Odavatel tundidel nihe +1 kuni +7, kallistel -1 kuni -7</li>
					<li><strong>Külma ilma kaitse:</strong> Alla {data.settings.cold_weather_threshold}°C vähendatakse kallite tundide karistust</li>
					<li><strong>Ilmaprognoos:</strong> Kasutatakse Open-Meteo API-t (Luige alevik, Harjumaa)</li>
				</ul>
			</div>
		</div>

		<div class="flex justify-end">
			<button type="submit" class="btn btn-primary">Salvesta seaded</button>
		</div>
	</form>

	<!-- Manual Recalculation -->
	<div class="card bg-base-100 shadow-xl mb-6">
		<div class="card-body">
			<h2 class="card-title">Käsitsi ümberarvutus</h2>
			<p class="text-sm opacity-70 mb-4">
				Arvuta tänane küttegraafik kohe ümber, kasutades praeguseid seadeid ja hindu.
				Kasulik pärast seadete muutmist, et näha muudatusi kohe.
			</p>
			<form method="POST" action="?/recalculate" use:enhance>
				<button type="submit" class="btn btn-secondary">
					Arvuta tänane graafik ümber
				</button>
			</form>
		</div>
	</div>
{/if}
