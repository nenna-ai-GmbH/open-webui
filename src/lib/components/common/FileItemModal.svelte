<script lang="ts">
	import { getContext, onMount, tick } from 'svelte';
	import { formatFileSize, getLineCount } from '$lib/utils';
	import { WEBUI_API_BASE_URL } from '$lib/constants';
	import { getKnowledgeById } from '$lib/apis/knowledge';
import { getFileById } from '$lib/apis/files';
  import {
    createPiiHighlightStyles,
    PiiSessionManager,
    type ExtendedPiiEntity
  } from '$lib/utils/pii';
  import RichTextInput from '$lib/components/common/RichTextInput.svelte';
  import { config } from '$lib/stores';

	const i18n = getContext('i18n');

	import Modal from './Modal.svelte';
	import XMark from '../icons/XMark.svelte';
	import Info from '../icons/Info.svelte';
	import Switch from './Switch.svelte';
	import Tooltip from './Tooltip.svelte';
	import dayjs from 'dayjs';
	import Spinner from './Spinner.svelte';

	export let item: any;
	export let show = false;
	export let edit = false;
export let conversationId: string | undefined = undefined; // chat conversation context to store known entities/modifiers

	let enableFullContent = false;

	let isPdf = false;
	let isDocx = false;
	let isAudio = false;
	let loading = false;
  let contextMenuEl: HTMLElement | null = null; // legacy, will be removed

	// Detect file types we render as extracted text (pdf, docx)
	$: isPdf =
		item?.meta?.content_type === 'application/pdf' ||
		(item?.name && item?.name.toLowerCase().endsWith('.pdf'));

	$: isDocx =
		item?.meta?.content_type ===
			'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
		(item?.name && item?.name.toLowerCase().endsWith('.docx'));

	$: isAudio =
		(item?.meta?.content_type ?? '').startsWith('audio/') ||
		(item?.name && item?.name.toLowerCase().endsWith('.mp3')) ||
		(item?.name && item?.name.toLowerCase().endsWith('.wav')) ||
		(item?.name && item?.name.toLowerCase().endsWith('.ogg')) ||
		(item?.name && item?.name.toLowerCase().endsWith('.m4a')) ||
		(item?.name && item?.name.toLowerCase().endsWith('.webm'));

	const loadContent = async () => {
		if (item?.type === 'collection') {
			loading = true;

			const knowledge = await getKnowledgeById(localStorage.token, item.id).catch((e) => {
				console.error('Error fetching knowledge base:', e);
				return null;
			});

			if (knowledge) {
				item.files = knowledge.files || [];
			}
			loading = false;
		} else if (item?.id) {
			// Refresh file metadata/data to ensure page_content and pii are present
			try {
				loading = true;
				const fresh = await getFileById(localStorage.token, item.id).catch(() => null);
				if (fresh) {
					item.file = fresh;
				}
			} catch (e) {
				// ignore
			} finally {
				loading = false;
			}
		}

		await tick();
	};

	$: if (show) {
		loadContent();
	}

	// Inject highlight styles once when modal mounts and PII preview is relevant
	let stylesInjected = false;
	function ensureHighlightStyles() {
		if (stylesInjected) return;
		const styleElement = document.createElement('style');
		styleElement.textContent = createPiiHighlightStyles();
		document.head.appendChild(styleElement);
		stylesInjected = true;
	}

	onMount(() => {
		if (item?.context === 'full') {
			enableFullContent = true;
		}
		ensureHighlightStyles();

    // No custom context menu needed; TipTap handles clicks/menus
	});

  // All entity interactions handled by TipTap extensions; remove custom menu

  // Compute external URL for non-previewable types
  $: externalUrl = item?.url
    ? (item.type === 'file' ? `${item.url}/content` : `${item.url}`)
    : '';

	// Build extended entities from backend detections (shape from retrieval.py)
	$: extendedEntities = (() => {
		const detections: any = item?.file?.data?.pii || null;
		if (!detections) return [] as ExtendedPiiEntity[];
		// detections is a dict keyed by raw text; values carry id,label,type,occurrences
		const values = Object.values(detections) as any[];
		const entities: ExtendedPiiEntity[] = values
			.map((e) => ({
				id: e.id,
				label: e.label,
				type: e.type || e.entity_type || 'PII',
				raw_text: e.raw_text || e.text || e.name || '',
				occurrences: (e.occurrences || []).map((o: any) => ({
					start_idx: o.start_idx,
					end_idx: o.end_idx
				})),
				shouldMask: true
			}))
			.filter((e) => e.raw_text && e.raw_text.trim() !== '');
		return entities;
	})();

  // When modal opens, seed PII session so RichTextInput-like behavior is possible in chat
  $: if (show) {
    try {
      const manager = PiiSessionManager.getInstance();
      if (Array.isArray(extendedEntities) && extendedEntities.length > 0) {
        if (conversationId && conversationId.trim() !== '') {
          // Persist entities for this conversation as known entities
          manager.setConversationEntitiesFromLatestDetection(conversationId, extendedEntities);
        } else {
          // New chat without conversationId: seed temporary state so extensions can render
          if (!manager.isTemporaryStateActive()) {
            manager.activateTemporaryState();
          }
          manager.setTemporaryStateEntities(extendedEntities);
        }
      }
    } catch (e) {}
  }

	// Determine pages to render; if page_content is missing, fall back to single content string
	$: pageContents = (() => {
		const pc = item?.file?.data?.page_content;
		if (Array.isArray(pc) && pc.length > 0) return pc as string[];
		const content = item?.file?.data?.content || '';
		return content ? [content] : [];
	})();

  // No precomputed HTML highlights; TipTap handles decorations

  // Keep per-page editor refs to sync PII entities from session
  let editors: any[] = [];

  function syncEditorsNow() {
    editors.forEach((ed) => {
      try {
        if (!ed || !ed.commands) return;
        if (typeof ed.commands.reloadConversationState === 'function') {
          ed.commands.reloadConversationState(conversationId);
        }
        if (typeof ed.commands.syncWithSessionManager === 'function') {
          ed.commands.syncWithSessionManager();
        }
        if (typeof ed.commands.forceEntityRemapping === 'function') {
          ed.commands.forceEntityRemapping();
        }
      } catch (e) {}
    });
  }

  // After showing modal, extended entities seeded (conv or temp), and editors mounted → sync twice
  $: if (show && Array.isArray(editors) && editors.length > 0 && extendedEntities.length > 0) {
    setTimeout(() => {
      syncEditorsNow();
      setTimeout(() => syncEditorsNow(), 150);
    }, 50);
  }
</script>

<Modal bind:show size="lg">
	<div class="font-primary px-6 py-5 w-full flex flex-col justify-center dark:text-gray-400">
		<div class=" pb-2">
			<div class="flex items-start justify-between">
				<div>
					<div class=" font-medium text-lg dark:text-gray-100">
                        <a
                            href={externalUrl || undefined}
                            rel="noopener noreferrer"
                            target="_blank"
							class="hover:underline line-clamp-1"
                            on:click|preventDefault={() => {
                                // Keep external open behavior only for non-previewable types
                                if (!(isPdf || isDocx) && externalUrl) {
                                    window.open(externalUrl, '_blank');
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
										{$i18n.t('Using Entire Document')}
									{:else}
										{$i18n.t('Using Focused Retrieval')}
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
			{#if !loading}
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

                    {#if isPdf || isDocx}
                        <!-- Render extracted text with TipTap editors per page (PII + Modifiers like RichTextInput) -->
                        {#if pageContents.length > 0}
                            <div class="space-y-6 mt-3">
                                {#each pageContents as pageText, idx}
                                    <div class="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-850">
                                        <div class="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
                                            <div>Page {idx + 1}</div>
                                            {#if item?.status === 'processing'}
                                                <div class="flex items-center gap-1">
                                                    <Spinner className="size-3" />
                                                    <span>Extracting...</span>
                                                </div>
                                            {/if}
                                        </div>
                                        <div class="p-3">
                                            <RichTextInput
                                                bind:editor={editors[idx]}
                                                className="input-prose-sm"
                                                value={pageText}
                                                preserveBreaks={false}
                                                raw={false}
                                                editable={true}
                                                preventDocEdits={true}
                                                showFormattingToolbar={false}
                                                enablePiiDetection={true}
                                                piiApiKey={$config?.pii?.api_key ?? 'preview-only'}
                                                conversationId={conversationId}
                                                piiMaskingEnabled={true}
                                                enablePiiModifiers={true}
                                                piiModifierLabels={[
                                                    'PERSON',
                                                    'EMAIL',
                                                    'PHONE_NUMBER',
                                                    'ADDRESS',
                                                    'SSN',
                                                    'CREDIT_CARD',
                                                    'DATE_TIME',
                                                    'IP_ADDRESS',
                                                    'URL',
                                                    'IBAN',
                                                    'MEDICAL_LICENSE',
                                                    'US_PASSPORT',
                                                    'US_DRIVER_LICENSE'
                                                ]}
                                                messageInput={false}
                                            />
                                        </div>
                                    </div>
                                {/each}
                            </div>
                        {:else}
                            <div class="flex items-center justify-center py-6 text-sm text-gray-500">
                                No extracted text available yet.
                            </div>
                        {/if}
                    {:else if item?.file?.data}
						<div class="max-h-96 overflow-scroll scrollbar-hidden text-xs whitespace-pre-wrap">
							{item?.file?.data?.content ?? 'No content'}
						</div>
					{/if}
				{/if}
			{:else}
				<div class="flex items-center justify-center py-6">
					<Spinner className="size-5" />
				</div>
			{/if}
		</div>
	</div>
</Modal>

<style>
	.break-words {
		word-break: break-word;
		overflow-wrap: anywhere;
	}
</style>
