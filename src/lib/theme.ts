import { writable } from 'svelte/store';

export type Theme = 'light' | 'dark';

function createThemeStore() {
	// Default to light
	let initialTheme: Theme = 'light';

	// Check localStorage (only in browser)
	if (typeof window !== 'undefined') {
		const stored = localStorage.getItem('theme');
		if (stored === 'light' || stored === 'dark') {
			initialTheme = stored;
		}
	}

	const { subscribe, set, update } = writable<Theme>(initialTheme);

	return {
		subscribe,
		set: (theme: Theme) => {
			if (typeof window !== 'undefined') {
				localStorage.setItem('theme', theme);
				document.documentElement.setAttribute('data-theme', theme);
			}
			set(theme);
		},
		toggle: () => {
			update((current) => {
				const newTheme = current === 'light' ? 'dark' : 'light';
				if (typeof window !== 'undefined') {
					localStorage.setItem('theme', newTheme);
					document.documentElement.setAttribute('data-theme', newTheme);
				}
				return newTheme;
			});
		},
		init: () => {
			if (typeof window !== 'undefined') {
				const stored = localStorage.getItem('theme') as Theme | null;
				const theme = stored === 'light' || stored === 'dark' ? stored : 'light';
				document.documentElement.setAttribute('data-theme', theme);
				set(theme);
			}
		}
	};
}

export const theme = createThemeStore();
