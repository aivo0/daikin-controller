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

<!-- Temperature Settings -->
{#if data.settings}
	<form method="POST" action="?/updateSettings" use:enhance>
		<div class="card bg-base-100 shadow-xl mb-6">
			<div class="card-body">
				<h2 class="card-title">Temperatuuri seaded</h2>

				<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
					<div class="form-control">
						<label class="label" for="min_temperature">
							<span class="label-text">Miinimum temperatuur (ohutuspiir)</span>
						</label>
						<input
							type="number"
							id="min_temperature"
							name="min_temperature"
							value={data.settings.min_temperature}
							min="15"
							max="25"
							step="0.5"
							class="input input-bordered"
						/>
						<span class="label-text-alt mt-1">Temperatuur ei lange kunagi alla selle</span>
					</div>

					<div class="form-control">
						<label class="label" for="base_temperature">
							<span class="label-text">Baastemperatuur</span>
						</label>
						<input
							type="number"
							id="base_temperature"
							name="base_temperature"
							value={data.settings.base_temperature}
							min="18"
							max="28"
							step="0.5"
							class="input input-bordered"
						/>
						<span class="label-text-alt mt-1">Tavaline töötemperatuur</span>
					</div>

					<div class="form-control">
						<label class="label" for="boost_delta">
							<span class="label-text">Kütmise lisand</span>
						</label>
						<input
							type="number"
							id="boost_delta"
							name="boost_delta"
							value={data.settings.boost_delta}
							min="0.5"
							max="5"
							step="0.5"
							class="input input-bordered"
						/>
						<span class="label-text-alt mt-1">Temperatuuri tõus odavate tundide ajal</span>
					</div>

					<div class="form-control">
						<label class="label" for="reduce_delta">
							<span class="label-text">Vähendamise lisand</span>
						</label>
						<input
							type="number"
							id="reduce_delta"
							name="reduce_delta"
							value={data.settings.reduce_delta}
							min="0.5"
							max="5"
							step="0.5"
							class="input input-bordered"
						/>
						<span class="label-text-alt mt-1">Temperatuuri langus kallite tundide ajal</span>
					</div>
				</div>
			</div>
		</div>

		<!-- Price Thresholds -->
		<div class="card bg-base-100 shadow-xl mb-6">
			<div class="card-body">
				<h2 class="card-title">Hinnapiirid</h2>

				<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
					<div class="form-control">
						<label class="label" for="low_price_threshold">
							<span class="label-text">Madala hinna piir (senti/kWh)</span>
						</label>
						<input
							type="number"
							id="low_price_threshold"
							name="low_price_threshold"
							value={data.settings.low_price_threshold}
							min="0"
							max="50"
							step="0.5"
							class="input input-bordered"
						/>
						<span class="label-text-alt mt-1">Küta rohkem kui hind on alla selle</span>
					</div>

					<div class="form-control">
						<label class="label" for="high_price_threshold">
							<span class="label-text">Kõrge hinna piir (senti/kWh)</span>
						</label>
						<input
							type="number"
							id="high_price_threshold"
							name="high_price_threshold"
							value={data.settings.high_price_threshold}
							min="0"
							max="100"
							step="0.5"
							class="input input-bordered"
						/>
						<span class="label-text-alt mt-1">Vähenda kütmist kui hind on üle selle</span>
					</div>

					<div class="form-control">
						<label class="label" for="cheapest_hours">
							<span class="label-text">Odavaimad tunnid kütmiseks</span>
						</label>
						<input
							type="number"
							id="cheapest_hours"
							name="cheapest_hours"
							value={data.settings.cheapest_hours}
							min="0"
							max="12"
							step="1"
							class="input input-bordered"
						/>
						<span class="label-text-alt mt-1">Mitu odavaimat tundi päevas kütta (0 = väljas)</span>
					</div>

					<div class="form-control">
						<label class="label" for="peak_hours_to_avoid">
							<span class="label-text">Tipptunnid vältimiseks</span>
						</label>
						<input
							type="number"
							id="peak_hours_to_avoid"
							name="peak_hours_to_avoid"
							value={data.settings.peak_hours_to_avoid}
							min="0"
							max="12"
							step="1"
							class="input input-bordered"
						/>
						<span class="label-text-alt mt-1">Mitu kallimat tundi vältida (0 = väljas)</span>
					</div>
				</div>
			</div>
		</div>

		<!-- Control Strategies -->
		<div class="card bg-base-100 shadow-xl mb-6">
			<div class="card-body">
				<h2 class="card-title">Juhtimisstrateegiad</h2>

				<div class="form-control">
					<label class="label cursor-pointer justify-start gap-4">
						<input
							type="checkbox"
							name="strategy_threshold"
							checked={data.settings.strategies_enabled.threshold}
							class="checkbox checkbox-primary"
						/>
						<div>
							<span class="label-text font-medium">Hinnapiir</span>
							<p class="text-sm opacity-70">Küta odavalt, vähenda kallilt</p>
						</div>
					</label>
				</div>

				<div class="form-control">
					<label class="label cursor-pointer justify-start gap-4">
						<input
							type="checkbox"
							name="strategy_cheapest"
							checked={data.settings.strategies_enabled.cheapest}
							class="checkbox checkbox-primary"
						/>
						<div>
							<span class="label-text font-medium">Odavaimad tunnid</span>
							<p class="text-sm opacity-70">Küta päeva N odavaimal tunnil</p>
						</div>
					</label>
				</div>

				<div class="form-control">
					<label class="label cursor-pointer justify-start gap-4">
						<input
							type="checkbox"
							name="strategy_peaks"
							checked={data.settings.strategies_enabled.peaks}
							class="checkbox checkbox-primary"
						/>
						<div>
							<span class="label-text font-medium">Tipptundide vältimine</span>
							<p class="text-sm opacity-70">Vähenda N kõige kallimat tundi</p>
						</div>
					</label>
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
							max="60"
							step="1"
							class="input input-bordered"
						/>
						<span class="label-text-alt mt-1">Boileri temperatuur ei lange alla selle (30-60°C)</span>
					</div>

					<div class="form-control">
						<label class="label" for="dhw_target_temp">
							<span class="label-text">Sihttemperatuur (°C)</span>
						</label>
						<input
							type="number"
							id="dhw_target_temp"
							name="dhw_target_temp"
							value={data.settings.dhw_target_temp}
							min="30"
							max="60"
							step="1"
							class="input input-bordered"
						/>
						<span class="label-text-alt mt-1">Soojendamise sihttemperatuur odavatel tundidel (30-60°C)</span>
					</div>
				</div>
			</div>
		</div>

		<div class="flex justify-end">
			<button type="submit" class="btn btn-primary">Salvesta seaded</button>
		</div>
	</form>
{/if}
