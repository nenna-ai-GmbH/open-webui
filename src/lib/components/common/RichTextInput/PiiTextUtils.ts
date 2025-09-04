/**
 * Pure utility functions for PII text processing
 * Shared between PiiDetectionExtension and PiiModifierExtension
 */

/**
 * Generate unique ID for modifiers
 */
export function generateModifierId(): string {
	return `modifier_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Decode common HTML entities to plain characters for matching
 */
export function decodeHtmlEntities(text: string): string {
	if (!text) return text;
	// Fast path for numeric entities and a few named ones we often see
	const named: Record<string, string> = {
		'&amp;': '&',
		'&lt;': '<',
		'&gt;': '>',
		'&quot;': '"',
		'&#39;': "'",
		'&nbsp;': '\u00A0'
	};
	let result = text.replace(/&(amp|lt|gt|quot|#39);/g, (m) => named[m] || m);
	// Generic numeric (decimal or hex)
	result = result.replace(/&#(x?[0-9a-fA-F]+);/g, (_m, code) => {
		try {
			const num =
				code[0] === 'x' || code[0] === 'X' ? parseInt(code.slice(1), 16) : parseInt(code, 10);
			if (!isNaN(num)) return String.fromCharCode(num);
		} catch {}
		return _m;
	});
	return result;
}

/**
 * Count words in text for granular change detection
 */
export function countWords(text: string): number {
	if (!text.trim()) return 0;
	// Split on whitespace and filter empty strings
	return text
		.trim()
		.split(/\s+/)
		.filter((word) => word.length > 0).length;
}

/**
 * Extract individual words from text for comparison
 */
export function extractWords(text: string): Set<string> {
	if (!text.trim()) return new Set();
	return new Set(
		text
			.trim()
			.toLowerCase()
			.split(/\s+/)
			.filter((word) => word.length > 0)
			.map((word) => word.replace(/[.,!?;:"'()[\]{}]/g, '')) // Remove punctuation
			.filter((word) => word.length > 0)
	);
}
