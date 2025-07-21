<script lang="ts">
	import { onMount } from 'svelte';
	import DOMPurify from 'dompurify';
	import { maskPiiText } from '$lib/apis/pii';
	import type { PiiEntity, KnownPiiEntity } from '$lib/apis/pii';
	import type { ExtendedPiiEntity } from '$lib/utils/pii';
	import { PiiSessionManager, unmaskAndHighlightTextForDisplay } from '$lib/utils/pii';
	import Spinner from '$lib/components/common/Spinner.svelte';

	export let text: string;
	export let fileId: string = '';
	export let fileName: string = '';
	export let piiApiKey: string = '';
	export let enablePiiDetection: boolean = false;
	export let conversationId: string = '';

	let containerElement: HTMLElement;
	let isDetecting = false;
	let processedText = text;
	let hasHighlighting = false;
	let piiEntities: ExtendedPiiEntity[] = [];
	let detectionError: string | null = null;

	const piiSessionManager = PiiSessionManager.getInstance();

	// Setup PII session manager
	$: if (enablePiiDetection && piiApiKey) {
		piiSessionManager.setApiKey(piiApiKey);
	}

	// Function to detect PII in the file text
	const detectPiiInText = async (textContent: string) => {
		if (!enablePiiDetection || !piiApiKey || !textContent.trim()) {
			processedText = textContent;
			hasHighlighting = false;
			return;
		}

		isDetecting = true;
		detectionError = null;

		try {
			console.log('PiiAwareFilePreview: Starting PII detection for file:', fileName);

			// Get known entities for consistent labeling across the conversation
			const knownEntities: KnownPiiEntity[] = conversationId
				? piiSessionManager.getKnownEntitiesForApi(conversationId)
				: [];

			console.log('PiiAwareFilePreview: Using known entities:', knownEntities);

			// Call the PII detection API
			const response = await maskPiiText(
				piiApiKey,
				[textContent],
				knownEntities,
				[], // No modifiers for file preview
				false, // Don't create session
				false // Don't use quiet mode
			);

			if (response.pii && response.pii[0] && response.pii[0].length > 0) {
				console.log('PiiAwareFilePreview: PII detected:', response.pii[0]);

				// Convert PII entities to extended entities with masking state
				const detectedEntities: ExtendedPiiEntity[] = response.pii[0].map((entity) => ({
					...entity,
					shouldMask: true // Default to masked for file previews
				}));

				piiEntities = detectedEntities;

				// Store entities in session manager for conversation consistency
				if (conversationId) {
					piiSessionManager.setConversationEntities(conversationId, response.pii[0]);
				}

				// Apply highlighting to the text
				processedText = unmaskAndHighlightTextForDisplay(textContent, detectedEntities);
				hasHighlighting = processedText !== textContent;

				console.log('PiiAwareFilePreview: Applied highlighting, hasHighlighting:', hasHighlighting);
			} else {
				console.log('PiiAwareFilePreview: No PII detected');
				processedText = textContent;
				hasHighlighting = false;
				piiEntities = [];
			}
		} catch (error) {
			console.error('PiiAwareFilePreview: PII detection failed:', error);
			detectionError = `PII detection failed: ${error.message || 'Unknown error'}`;
			processedText = textContent;
			hasHighlighting = false;
			piiEntities = [];
		} finally {
			isDetecting = false;
		}
	};

	// Reactive statement to trigger PII detection when text or settings change
	$: if (text !== processedText || enablePiiDetection) {
		detectPiiInText(text);
	}

	// Load conversation state when conversationId changes
	$: if (conversationId && conversationId !== '') {
		piiSessionManager.loadConversationState(conversationId);
	}

	// Handle clicks on PII highlights to toggle masking
	const handlePiiClick = (event: MouseEvent) => {
		const target = event.target as HTMLElement;
		
		if (target.classList.contains('pii-highlight')) {
			const piiLabel = target.getAttribute('data-pii-label');
			
			if (piiLabel && piiEntities.length > 0) {
				// Find the entity and toggle its masking state
				const entityIndex = piiEntities.findIndex(entity => entity.label === piiLabel);
				
				if (entityIndex !== -1) {
					// Toggle the shouldMask state
					piiEntities[entityIndex].shouldMask = !piiEntities[entityIndex].shouldMask;
					
					// Update session manager
					if (conversationId) {
						piiSessionManager.toggleEntityMasking(piiLabel, 0, conversationId);
					}
					
					// Re-process the text with updated highlighting
					processedText = unmaskAndHighlightTextForDisplay(text, piiEntities);
					hasHighlighting = processedText !== text;
					
					console.log('PiiAwareFilePreview: Toggled PII masking for:', piiLabel);
				}
			}
		}
	};

	onMount(() => {
		// Add click listener for PII interaction
		if (containerElement) {
			containerElement.addEventListener('click', handlePiiClick);
			
			return () => {
				containerElement.removeEventListener('click', handlePiiClick);
			};
		}
	});
</script>

<div 
	bind:this={containerElement} 
	class="relative max-h-96 overflow-scroll scrollbar-hidden text-xs whitespace-pre-wrap"
>
	<!-- PII Detection Loading Indicator -->
	{#if isDetecting}
		<div class="absolute top-2 right-2 flex items-center gap-1 bg-gray-50 dark:bg-gray-850 px-2 py-1 rounded-md shadow-sm border border-gray-200 dark:border-gray-700 z-10">
			<Spinner className="size-3" />
			<span class="text-xs text-gray-600 dark:text-gray-400">Scanning for PII...</span>
		</div>
	{/if}

	<!-- Error Message -->
	{#if detectionError}
		<div class="mb-2 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
			<div class="flex items-center gap-1">
				<svg class="size-4 text-red-500" fill="currentColor" viewBox="0 0 20 20">
					<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" />
				</svg>
				<span class="text-xs text-red-700 dark:text-red-300">{detectionError}</span>
			</div>
		</div>
	{/if}

	<!-- Content with PII Highlighting -->
	{#if hasHighlighting}
		{@html DOMPurify.sanitize(processedText)}
	{:else}
		{text || 'No content'}
	{/if}

	<!-- PII Summary Footer -->
	{#if piiEntities.length > 0 && !isDetecting}
		<div class="mt-3 pt-2 border-t border-gray-200 dark:border-gray-700">
			<div class="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
				<span>{piiEntities.length} PII entit{piiEntities.length === 1 ? 'y' : 'ies'} detected</span>
				<span class="text-xs">Click highlighted text to toggle masking</span>
			</div>
		</div>
	{/if}
</div>

<style>
	/* PII Highlighting Styles */
	:global(.pii-highlight) {
		cursor: pointer;
		transition: all 0.2s ease;
		border-radius: 3px;
		padding: 1px 2px;
		position: relative;
	}

	:global(.pii-highlight:hover) {
		transform: translateY(-1px);
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
	}

	/* Masked entities - dark green font, green background, green dashed underline */
	:global(.pii-highlight.pii-masked) {
		color: #15803d;
		background-color: rgba(34, 197, 94, 0.2);
		border-bottom: 2px dashed #15803d;
	}

	:global(.pii-highlight.pii-masked:hover) {
		background-color: rgba(34, 197, 94, 0.3);
		border-bottom: 3px dashed #15803d;
	}

	/* Unmasked entities - red background, solid red underline */
	:global(.pii-highlight.pii-unmasked) {
		background-color: rgba(239, 68, 68, 0.2);
		border-bottom: 1px solid #dc2626;
	}

	:global(.pii-highlight.pii-unmasked:hover) {
		background-color: rgba(239, 68, 68, 0.3);
		border-bottom: 2px solid #dc2626;
	}
</style> 