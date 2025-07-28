<script lang="ts">
	/**
	 * PiiFileTextPreview.svelte
	 *
	 * Enhanced file text preview component with:
	 * - Page break visualization
	 * - Future PII highlighting capabilities
	 * - Clean separation from original FileItemModal
	 */

	export let content = '';
	export let filename = '';
	export let lineCount = 0;

	// Process content to detect and style page breaks
	function processContentWithPageBreaks(text: string): string {
		if (!text) return '';

		// Split on page markers that we added in the backend
		const pagePattern = /^--- PAGE (\d+) ---$/gm;

		// Check if content has page markers
		if (pagePattern.test(text)) {
			// Replace page markers with styled HTML
			return text.replace(pagePattern, '<div class="page-break-marker">📄 Page $1</div>');
		}

		// No page markers - return content as-is
		return text;
	}

	$: processedContent = processContentWithPageBreaks(content);
</script>

<div
	class="pii-file-preview max-h-96 overflow-scroll scrollbar-hidden text-xs bg-gray-50 dark:bg-gray-800 p-4 rounded-lg mt-4"
>
	<!-- Header with file info -->
	<div
		class="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300 border-b border-gray-200 dark:border-gray-600 pb-2"
	>
		📄 {filename} ({lineCount} lines)
	</div>

	<!-- Content with page breaks -->
	<div class="whitespace-pre-wrap">
		{@html processedContent}
	</div>
</div>

<style>
	.pii-file-preview {
		/* Base styling for the preview container */
		font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
		line-height: 1.4;
	}

	:global(.page-break-marker) {
		/* Style for page break indicators */
		display: block;
		margin: 1rem 0;
		padding: 0.5rem 1rem;
		background: linear-gradient(90deg, #e5e7eb 0%, #f3f4f6 50%, #e5e7eb 100%);
		border-left: 4px solid #6b7280;
		border-radius: 0.25rem;
		font-weight: 600;
		font-size: 0.75rem;
		color: #374151;
		text-align: center;
	}

	:global(.dark .page-break-marker) {
		background: linear-gradient(90deg, #374151 0%, #4b5563 50%, #374151 100%);
		border-left-color: #9ca3af;
		color: #d1d5db;
	}

	/* Future PII highlighting styles (placeholder) */
	:global(.pii-highlight) {
		background-color: #fef3c7;
		border-radius: 0.25rem;
		padding: 0 0.25rem;
	}

	:global(.dark .pii-highlight) {
		background-color: #92400e;
		color: #fed7aa;
	}
</style>
