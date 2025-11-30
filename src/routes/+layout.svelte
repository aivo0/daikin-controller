<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { page } from '$app/stores';
	import { authClient } from '$lib/auth-client';

	let { children, data } = $props();

	const navItems = [
		{ href: '/', label: 'Töölaud', icon: '📊' },
		{ href: '/settings', label: 'Seaded', icon: '⚙️' },
		{ href: '/history', label: 'Ajalugu', icon: '📈' }
	];

	async function signOut() {
		await authClient.signOut();
		window.location.href = '/login';
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Soojuspumba Kamandaja</title>
</svelte:head>

<div class="min-h-screen bg-base-200">
	<div class="navbar bg-base-100 shadow-lg">
		<div class="flex-1">
			<a href="/" class="btn btn-ghost text-xl">Soojuspumba Kamandaja</a>
		</div>
		<div class="flex-none">
			{#if data.user}
				<ul class="menu menu-horizontal px-1">
					{#each navItems as item}
						<li>
							<a
								href={item.href}
								class:active={$page.url.pathname === item.href}
							>
								{item.icon} {item.label}
							</a>
						</li>
					{/each}
				</ul>
				<div class="dropdown dropdown-end ml-2">
					<div tabindex="0" role="button" class="btn btn-ghost btn-circle avatar">
						{#if data.user.image}
							<div class="w-10 rounded-full">
								<img alt="User avatar" src={data.user.image} />
							</div>
						{:else}
							<div class="w-10 rounded-full bg-primary text-primary-content flex items-center justify-center">
								{data.user.name?.charAt(0) || data.user.email?.charAt(0) || '?'}
							</div>
						{/if}
					</div>
					<ul tabindex="0" class="menu menu-sm dropdown-content bg-base-100 rounded-box z-50 mt-3 w-52 p-2 shadow">
						<li class="menu-title"><span>{data.user.email}</span></li>
						<li><button onclick={signOut}>Logi välja</button></li>
					</ul>
				</div>
			{/if}
		</div>
	</div>

	<main class="container mx-auto p-4 max-w-6xl">
		{@render children()}
	</main>
</div>
