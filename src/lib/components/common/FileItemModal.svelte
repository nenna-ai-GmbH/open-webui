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
