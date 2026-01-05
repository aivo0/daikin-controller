import { writable, derived } from 'svelte/store';
import et from './et';
import en from './en';

export type Locale = 'et' | 'en';
export type Translations = typeof et;

const translations: Record<Locale, Translations> = { et, en };

// Create locale store with browser/localStorage detection
function createLocaleStore() {
	// Default to Estonian
	let initialLocale: Locale = 'et';

	// Check localStorage first (only in browser)
	if (typeof window !== 'undefined') {
		const stored = localStorage.getItem('locale');
		if (stored === 'et' || stored === 'en') {
			initialLocale = stored;
		} else {
			// Fall back to browser language
			const browserLang = navigator.language.split('-')[0];
			if (browserLang === 'en') {
				initialLocale = 'en';
			}
		}
	}

	const { subscribe, set } = writable<Locale>(initialLocale);

	return {
		subscribe,
		set: (locale: Locale) => {
			if (typeof window !== 'undefined') {
				localStorage.setItem('locale', locale);
			}
			set(locale);
		}
	};
}

export const locale = createLocaleStore();

// Derived store for translations
export const t = derived(locale, ($locale) => translations[$locale]);

// Helper to get locale code for date formatting
export const dateLocale = derived(locale, ($locale) => ($locale === 'et' ? 'et-EE' : 'en-US'));

// Export translations for direct access if needed
export { et, en };
