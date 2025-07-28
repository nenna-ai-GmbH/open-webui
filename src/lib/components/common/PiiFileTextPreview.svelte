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

	// Process content to detect and style page/chunk breaks
	function processContentWithBreaks(text: string): string {
		if (!text) return '';

		// Patterns for both page and chunk markers
		const pagePattern = /^--- PAGE (\d+) ---$/gm;
		const chunkPattern = /^--- CHUNK (\d+) ---$/gm;

		// Check for page markers first (higher priority)
		if (pagePattern.test(text)) {
			return text.replace(pagePattern, '<div class="break-marker page-marker">📄 Page $1</div>');
		}

		// Check for chunk markers
		if (chunkPattern.test(text)) {
			return text.replace(chunkPattern, '<div class="break-marker chunk-marker">📝 Chunk $1</div>');
		}

		// No markers - return content as-is
		return text;
	}

	$: processedContent = processContentWithBreaks(content);
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

	:global(.break-marker) {
		/* Base styling for all break markers */
		display: block;
		margin: 1rem 0;
		padding: 0.5rem 1rem;
		border-radius: 0.25rem;
		font-weight: 600;
		font-size: 0.75rem;
		text-align: center;
	}

	:global(.page-marker) {
		/* Page-specific styling */
		background: linear-gradient(90deg, #e5e7eb 0%, #f3f4f6 50%, #e5e7eb 100%);
		border-left: 4px solid #6b7280;
		color: #374151;
	}

	:global(.chunk-marker) {
		/* Chunk-specific styling */
		background: linear-gradient(90deg, #fef3c7 0%, #fef9e7 50%, #fef3c7 100%);
		border-left: 4px solid #d97706;
		color: #92400e;
	}

	:global(.dark .page-marker) {
		background: linear-gradient(90deg, #374151 0%, #4b5563 50%, #374151 100%);
		border-left-color: #9ca3af;
		color: #d1d5db;
	}

	:global(.dark .chunk-marker) {
		background: linear-gradient(90deg, #92400e 0%, #b45309 50%, #92400e 100%);
		border-left-color: #f59e0b;
		color: #fed7aa;
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
