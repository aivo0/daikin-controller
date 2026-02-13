<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { page } from '$app/stores';
	import { authClient } from '$lib/auth-client';
	import { t, locale, type Locale } from '$lib/i18n';
	import { theme } from '$lib/theme';
	import { onMount } from 'svelte';

	let { children, data } = $props();

	const navItems = [
		{ href: '/', key: 'dashboard' as const, icon: '📊' },
		{ href: '/consumption', key: 'consumption' as const, icon: '⚡' },
		{ href: '/history', key: 'history' as const, icon: '📈' },
		{ href: '/settings', key: 'settings' as const, icon: '⚙️' }
	];

	onMount(() => {
		theme.init();
	});

	async function signOut() {
		await authClient.signOut();
		window.location.href = '/login';
	}

	function setLocale(newLocale: Locale) {
		locale.set(newLocale);
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>{$t.appName}</title>
</svelte:head>

<div class="min-h-screen bg-base-200">
	<div class="navbar bg-base-100 shadow-lg px-2 sm:px-4 flex-nowrap">
		<div class="flex-1 min-w-0">
			<a href="/" class="btn btn-ghost text-lg sm:text-xl px-2">{$t.appName}</a>
		</div>
			{#if data.user}
				<div class="flex-none flex items-center gap-1 sm:gap-2 flex-nowrap">
					<!-- Desktop nav links - hidden on mobile -->
					<ul class="menu menu-horizontal px-1 hidden lg:flex shrink-0">
					{#each navItems as item}
						<li>
							<a
								href={item.href}
								class:active={$page.url.pathname === item.href}
							>
								{item.icon} {$t.nav[item.key]}
							</a>
						</li>
					{/each}
				</ul>
				<!-- Theme toggle -->
				<button class="btn btn-ghost btn-sm" onclick={() => theme.toggle()} aria-label="Toggle theme">
					{#if $theme === 'light'}
						<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
						</svg>
					{:else}
						<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
						</svg>
					{/if}
				</button>
				<!-- Language switcher -->
				<div class="dropdown dropdown-end">
					<div tabindex="0" role="button" class="btn btn-ghost btn-sm gap-1">
						<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
						</svg>
						{$locale.toUpperCase()}
					</div>
					<ul tabindex="0" class="menu menu-sm dropdown-content bg-base-100 rounded-box z-50 mt-3 w-32 p-2 shadow">
						<li><button onclick={() => setLocale('et')} class:active={$locale === 'et'}>Eesti</button></li>
						<li><button onclick={() => setLocale('en')} class:active={$locale === 'en'}>English</button></li>
					</ul>
				</div>
				<!-- User menu -->
				<div class="dropdown dropdown-end">
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
						<li><button onclick={signOut}>{$t.nav.signOut}</button></li>
					</ul>
				</div>
				<!-- Mobile hamburger menu - visible only on mobile -->
				<div class="dropdown dropdown-end lg:hidden">
					<div tabindex="0" role="button" class="btn btn-ghost btn-sm">
						<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
						</svg>
					</div>
					<ul tabindex="0" class="menu menu-sm dropdown-content bg-base-100 rounded-box z-50 mt-3 w-52 p-2 shadow">
						{#each navItems as item}
							<li>
								<a
									href={item.href}
									class:active={$page.url.pathname === item.href}
								>
									{item.icon} {$t.nav[item.key]}
								</a>
							</li>
						{/each}
					</ul>
				</div>
			</div>
		{/if}
	</div>

	<main class="container mx-auto p-4 max-w-6xl">
		{@render children()}
	</main>
</div>
