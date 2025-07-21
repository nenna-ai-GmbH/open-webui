<script lang="ts">
	import { getContext, onMount } from 'svelte';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';
	import { formatFileSize, getLineCount } from '$lib/utils';
	import { WEBUI_API_BASE_URL } from '$lib/constants';

	const i18n = getContext<Writable<i18nType>>('i18n');

	import Modal from './Modal.svelte';
	import XMark from '../icons/XMark.svelte';
	import Info from '../icons/Info.svelte';
	import Switch from './Switch.svelte';
	import Tooltip from './Tooltip.svelte';
	import PiiAwareFilePreview from './PiiAwareFilePreview.svelte';
	import { extractStoredPiiEntities } from '$lib/utils/files';
	import dayjs from 'dayjs';

	export let item;
	export let show = false;
	export let edit = false;

	// PII Detection props
	export let enablePiiDetection = false;
	export let piiApiKey = '';
	export let conversationId = '';

	let enableFullContent = false;

	let isPdf = false;
	let isAudio = false;

	$: isPDF =
		item?.meta?.content_type === 'application/pdf' ||
		(item?.name && item?.name.toLowerCase().endsWith('.pdf'));

	$: isAudio =
		(item?.meta?.content_type ?? '').startsWith('audio/') ||
		(item?.name && item?.name.toLowerCase().endsWith('.mp3')) ||
		(item?.name && item?.name.toLowerCase().endsWith('.wav')) ||
		(item?.name && item?.name.toLowerCase().endsWith('.ogg')) ||
		(item?.name && item?.name.toLowerCase().endsWith('.m4a')) ||
		(item?.name && item?.name.toLowerCase().endsWith('.webm'));

	onMount(() => {
		console.log(item);
		if (item?.context === 'full') {
			enableFullContent = true;
		}
	});

	// Handle text changes from PII masking/unmasking
	const handleTextChanged = (event) => {
		const { originalText, processedText, entity, wasUnmasked } = event.detail;
		
		console.log('FileItemModal: Text changed due to PII toggle:', {
			entityLabel: entity.label,
			newState: entity.shouldMask ? 'masked' : 'unmasked',
			wasUnmasked
		});

		// Update the item's content with the new original text
		if (item?.file?.data) {
			item.file.data.content = originalText;
		} else if (item?.data) {
			item.data.content = originalText;
		}

		// Trigger reactivity
		item = item;
	};
</script>

<Modal bind:show size="lg">
	<div class="font-primary px-6 py-5 w-full flex flex-col justify-center dark:text-gray-400">
		<div class=" pb-2">
			<div class="flex items-start justify-between">
				<div>
					<div class=" font-medium text-lg dark:text-gray-100">
						<a
							href="#"
							class="hover:underline line-clamp-1"
							on:click|preventDefault={() => {
								if (!isPDF && item.url) {
									window.open(
										item.type === 'file' ? `${item.url}/content` : `${item.url}`,
										'_blank'
									);
								}
							}}
						>
							{item?.name ?? 'File'}
						</a>
					</div>
				</div>

				<div>
					<button
						on:click={() => {
							show = false;
						}}
					>
						<XMark />
					</button>
				</div>
			</div>

			<div>
				<div class="flex flex-col items-center md:flex-row gap-1 justify-between w-full">
					<div class=" flex flex-wrap text-sm gap-1 text-gray-500">
						{#if item?.type === 'collection'}
							{#if item?.type}
								<div class="capitalize shrink-0">{item.type}</div>
								•
							{/if}

							{#if item?.description}
								<div class="line-clamp-1">{item.description}</div>
								•
							{/if}

							{#if item?.created_at}
								<div class="capitalize shrink-0">
									{dayjs(item.created_at * 1000).format('LL')}
								</div>
							{/if}
						{/if}

						{#if item.size}
							<div class="capitalize shrink-0">{formatFileSize(item.size)}</div>
							•
						{/if}

						{#if item?.file?.data?.content}
							<div class="capitalize shrink-0">
								{getLineCount(item?.file?.data?.content ?? '')} extracted lines
							</div>

							<div class="flex items-center gap-1 shrink-0">
								<Info />

								Formatting may be inconsistent from source.
							</div>
						{/if}

						{#if item?.knowledge}
							<div class="capitalize shrink-0">
								{$i18n.t('Knowledge Base')}
							</div>
						{/if}
					</div>

					{#if edit}
						<div>
							<Tooltip
								content={enableFullContent
									? $i18n.t(
											'Inject the entire content as context for comprehensive processing, this is recommended for complex queries.'
										)
									: $i18n.t(
											'Default to segmented retrieval for focused and relevant content extraction, this is recommended for most cases.'
										)}
							>
								<div class="flex items-center gap-1.5 text-xs">
									{#if enableFullContent}
										Using Entire Document
									{:else}
										Using Focused Retrieval
									{/if}
									<Switch
										bind:state={enableFullContent}
										on:change={(e) => {
											item.context = e.detail ? 'full' : undefined;
										}}
									/>
								</div>
							</Tooltip>
						</div>
					{/if}
				</div>
			</div>
		</div>

		<div class="max-h-[75vh] overflow-auto">
			{#if item?.type === 'collection'}
				<div>
					{#each item?.files as file}
						<div class="flex items-center gap-2 mb-2">
							<div class="flex-shrink-0 text-xs">
								{file?.meta?.name}
							</div>
						</div>
					{/each}
				</div>
			{:else}
				{#if isAudio}
					<audio
						src={`${WEBUI_API_BASE_URL}/files/${item.id}/content`}
						class="w-full border-0 rounded-lg mb-2"
						controls
						playsinline
					/>
				{/if}

				{#if item?.file?.data?.content}
					<!-- Progressive Processing Status -->
					{#if item?.file?.data?.isProcessingInProgress || item?.file?.data?.isPartialContent || item?.file?.data?.processing_status}
						<div class="mb-3 p-3 {item?.file?.data?.isProcessingInProgress ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800' : 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'} border rounded-lg">
							<div class="flex items-center gap-2">
								{#if item?.file?.data?.isProcessingInProgress}
									<!-- Processing in progress -->
									<svg class="animate-spin size-4 text-blue-500" fill="none" viewBox="0 0 24 24">
										<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
										<path class="opacity-75" fill="currentColor" d="m4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
									</svg>
									<span class="text-sm text-blue-700 dark:text-blue-300 font-medium">
										{item?.file?.data?.processing_status || 'Processing pages...'}
									</span>
								{:else if item?.file?.data?.processing_status?.includes('✅')}
									<!-- Completed -->
									<svg class="size-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
										<path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
									</svg>
									<span class="text-sm text-green-700 dark:text-green-300 font-medium">
										{item?.file?.data?.processing_status || 'Processing complete'}
									</span>
								{:else}
									<!-- Partial complete -->
									<svg class="size-4 text-orange-500" fill="currentColor" viewBox="0 0 20 20">
										<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
									</svg>
									<span class="text-sm text-orange-700 dark:text-orange-300 font-medium">
										{item?.file?.data?.processing_status || 'Partially processed'}
									</span>
								{/if}
							</div>
							{#if item?.file?.data?.page_count}
								<div class="mt-1 text-xs text-gray-600 dark:text-gray-400">
									{item?.file?.data?.page_count} page{item?.file?.data?.page_count === 1 ? '' : 's'} total
									{#if item?.file?.data?.piiEntities?.length > 0}
										• <span class="font-medium text-red-600 dark:text-red-400">{item?.file?.data?.piiEntities.length} PII entit{item?.file?.data?.piiEntities.length === 1 ? 'y' : 'ies'} detected & protected</span>
									{:else}
										• <span class="text-green-600 dark:text-green-400">No PII detected</span>
									{/if}
								</div>
							{/if}
						</div>
					{/if}

					<!-- Show extracted text content with PII detection for both PDF and DOCX -->
					<PiiAwareFilePreview
						text={item?.file?.data?.content ?? 'No content'}
						fileId={item?.id ?? ''}
						fileName={item?.name ?? ''}
						{enablePiiDetection}
						{piiApiKey}
						{conversationId}
						storedPiiEntities={extractStoredPiiEntities(item)}
						on:textChanged={handleTextChanged}
					/>
				{:else if isPDF}
					<!-- Fallback: Show PDF iframe only if no extracted text is available -->
					<div class="mb-4">
						<p class="text-sm text-gray-600 dark:text-gray-400 mb-2">
							No extracted text available. Showing PDF viewer:
						</p>
						<iframe
							title={item?.name}
							src={`${WEBUI_API_BASE_URL}/files/${item.id}/content`}
							class="w-full h-[70vh] border-0 rounded-lg"
						/>
					</div>
				{:else}
					<!-- No content available for non-PDF files -->
					<div class="text-center py-8 text-gray-500">
						<p>No content available for preview</p>
					</div>
				{/if}
			{/if}
		</div>
	</div>
</Modal>
