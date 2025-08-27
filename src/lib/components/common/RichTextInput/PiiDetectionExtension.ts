import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import type { ExtendedPiiEntity } from '$lib/utils/pii';
import type { PiiEntity } from '$lib/apis/pii';
import { maskPiiText } from '$lib/apis/pii';
import { debounce, PiiSessionManager } from '$lib/utils/pii';
import type { PiiModifier } from './PiiModifierExtension';

// Interface for PII entity occurrences
interface PiiOccurrence {
	start_idx: number;
	end_idx: number;
}

interface PositionMapping {
	plainTextToProseMirror: Map<number, number>;
	proseMirrorToPlainText: Map<number, number>;
	plainText: string;
}
// Decode common HTML entities to plain characters for matching
function decodeHtmlEntities(text: string): string {
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

interface PiiDetectionState {
	entities: ExtendedPiiEntity[];
	positionMapping: PositionMapping | null;
	isDetecting: boolean;
	lastText: string;
	needsSync: boolean;
	userEdited?: boolean;
}

export interface PiiDetectionOptions {
	enabled: boolean;
	apiKey: string;
	conversationId?: string | undefined;
	getShouldMask?: () => boolean; // Dynamic function to get current masking state
	onPiiDetected?: (entities: ExtendedPiiEntity[], maskedText: string) => void;
	onPiiToggled?: (entities: ExtendedPiiEntity[]) => void;
	onPiiDetectionStateChanged?: (isDetecting: boolean) => void;
	debounceMs?: number;
	detectOnlyAfterUserEdit?: boolean; // If true, do not auto-detect on initial load; wait for user edits
}

// Removed unused interfaces - let TypeScript infer TipTap command types

// Build position mapping between plain text and ProseMirror positions
function buildPositionMapping(doc: ProseMirrorNode): PositionMapping {
	const plainTextToProseMirror = new Map<number, number>();
	const proseMirrorToPlainText = new Map<number, number>();
	let plainTextOffset = 0;
	let plainText = '';

	function addSyntheticChar(ch: string, pmPos: number) {
		const plainPos = plainTextOffset;
		plainTextToProseMirror.set(plainPos, pmPos);
		proseMirrorToPlainText.set(pmPos, plainPos);
		plainText += ch;
		plainTextOffset += ch.length;
	}

	let previousWasTableCell = false;

	doc.nodesBetween(0, doc.content.size, (node, pos, parent, index) => {
		if (node.isText && node.text) {
			for (let i = 0; i < node.text.length; i++) {
				const proseMirrorPos = pos + i;
				const plainTextPos = plainTextOffset + i;
				plainTextToProseMirror.set(plainTextPos, proseMirrorPos);
				proseMirrorToPlainText.set(proseMirrorPos, plainTextPos);
			}
			plainText += node.text;
			plainTextOffset += node.text.length;
			previousWasTableCell = false;
		} else {
			const typeName = node.type.name;

			// Insert block separators BEFORE starting a new block
			const needsLeadingNewline = () => plainTextOffset > 0 && plainText.charAt(plainTextOffset - 1) !== '\n';

			if (typeName === 'tableRow') {
				if (needsLeadingNewline()) addSyntheticChar('\n', pos);
				previousWasTableCell = false;
			} else if (typeName === 'tableCell' || typeName === 'tableHeader') {
				if (previousWasTableCell) addSyntheticChar('\t', pos);
				previousWasTableCell = true;
			} else if (typeName === 'hardBreak') {
				addSyntheticChar('\n', pos);
				previousWasTableCell = false;
			} else if (
				typeName === 'paragraph' ||
				typeName === 'heading' ||
				typeName === 'blockquote' ||
				typeName === 'codeBlock' ||
				typeName === 'listItem' ||
				typeName === 'bulletList' ||
				typeName === 'orderedList' ||
				typeName === 'taskList'
			) {
				if (needsLeadingNewline()) addSyntheticChar('\n', pos);
				previousWasTableCell = false;
			} else {
				previousWasTableCell = false;
			}
		}
		return true;
	});

	return { plainTextToProseMirror, proseMirrorToPlainText, plainText };
}

// Convert PII entity positions from plain text to ProseMirror positions
// Preserves existing shouldMask state from current entities
function mapPiiEntitiesToProseMirror(
	entities: PiiEntity[],
	mapping: PositionMapping,
	existingEntities: ExtendedPiiEntity[] = [],
	defaultShouldMask: boolean = true
): ExtendedPiiEntity[] {
	return entities.map((entity) => {
		// Find existing entity with same label to preserve shouldMask state
		const existingEntity = existingEntities.find((existing) => existing.label === entity.label);
		const shouldMask = existingEntity?.shouldMask ?? defaultShouldMask; // Use defaultShouldMask if not found

		return {
			...entity,
			shouldMask,
			occurrences: entity.occurrences.map((occurrence: PiiOccurrence) => {
				const plainTextStart = occurrence.start_idx;
				const plainTextEnd = occurrence.end_idx;

				const proseMirrorStart =
					mapping.plainTextToProseMirror.get(plainTextStart) ?? plainTextStart + 1;
				const proseMirrorEnd =
					mapping.plainTextToProseMirror.get(plainTextEnd - 1) ?? plainTextEnd - 1 + 1;

				return {
					...occurrence,
					start_idx: proseMirrorStart,
					end_idx: proseMirrorEnd + 1
				};
			})
		};
	});
}

// Validate entity positions and remove invalid ones
function validateAndFilterEntities(
	entities: ExtendedPiiEntity[],
	doc: ProseMirrorNode,
	mapping: PositionMapping
): ExtendedPiiEntity[] {
	return entities.filter((entity) => {
		// Check if entity still exists in the current text
		const entityText = decodeHtmlEntities(entity.raw_text).toLowerCase();
		const currentText = decodeHtmlEntities(mapping.plainText).toLowerCase();

		if (!currentText.includes(entityText)) {
			console.log(
				`PiiDetectionExtension: Entity "${entity.label}" no longer exists in text, removing`
			);
			return false;
		}

		// Validate all occurrences have valid positions
		const validOccurrences = entity.occurrences.filter((occurrence: PiiOccurrence) => {
			const { start_idx: from, end_idx: to } = occurrence;
			return from >= 0 && to <= doc.content.size && from < to;
		});

		if (validOccurrences.length === 0) {
			console.log(
				`PiiDetectionExtension: Entity "${entity.label}" has no valid positions, removing`
			);
			return false;
		}

		// Update entity with only valid occurrences
		entity.occurrences = validOccurrences;
		return true;
	});
}

// Resolve overlapping occurrences across all entities by preferring longer spans and stronger types
function resolveOverlaps(entities: ExtendedPiiEntity[], doc: ProseMirrorNode): ExtendedPiiEntity[] {
	interface SpanRef { entityIdx: number; occIdx: number; from: number; to: number; length: number; score: number }
	const typePriority: Record<string, number> = {
		PERSON: 5,
		ADDRESS: 4,
		DATE: 4,
		EMAIL: 4,
		PHONE_NUMBER: 4,
		ORGANISATION: 3,
		ORGANIZATION: 3,
		LOCATION: 3
	};

	const spans: SpanRef[] = [];
	entities.forEach((e, ei) => {
		(e.occurrences || []).forEach((o, oi) => {
			const length = o.end_idx - o.start_idx;
			const base = Math.max(length, (e.raw_text || '').length);
			const pri = typePriority[(e.type || '').toUpperCase()] || 1;
			// Penalty for very short/fragmentary entities
			const shortPenalty = (e.raw_text || '').trim().length <= 3 ? -5 : 0;
			spans.push({ entityIdx: ei, occIdx: oi, from: o.start_idx, to: o.end_idx, length, score: base * 10 + pri + shortPenalty });
		});
	});

	spans.sort((a, b) => b.score - a.score);
	const kept: boolean[][] = entities.map((e) => new Array((e.occurrences || []).length).fill(false));
	const used: Array<{ from: number; to: number }> = [];

	for (const s of spans) {
		const overlaps = used.some((u) => s.from < u.to && s.to > u.from);
		if (!overlaps) {
			kept[s.entityIdx][s.occIdx] = true;
			used.push({ from: s.from, to: s.to });
		}
	}

	const result: ExtendedPiiEntity[] = [];
	entities.forEach((e, ei) => {
		const occ: PiiOccurrence[] = [] as any;
		(e.occurrences || []).forEach((o, oi) => {
			if (kept[ei][oi]) occ.push(o as any);
		});
		if (occ.length > 0) {
			result.push({ ...e, occurrences: occ });
		}
	});
	return result;
}

// Remap existing entities to current document positions
function remapEntitiesForCurrentDocument(
	entities: ExtendedPiiEntity[],
	mapping: PositionMapping,
	doc: ProseMirrorNode
): ExtendedPiiEntity[] {
	if (!entities.length || !mapping.plainText) {
		return [];
	}

	const remappedEntities = entities.map((entity) => {
		// Decode HTML entities in raw_text so matching aligns with rendered text
		let entityText = decodeHtmlEntities(entity.raw_text);

		// Normalize edges: strip table pipes, leading/trailing punctuation artifacts
		// Keep internal punctuation as-is
		entityText = entityText
			.normalize('NFKC')
			.replace(/^[\s\u00A0\t|:;.,\-_/\\]+/, '')
			.replace(/[\s\u00A0\t|:;.,\-_/\\]+$/, '');

		const searchSource = decodeHtmlEntities(mapping.plainText);

		// Build a whitespace-tolerant regex for the entity text
		const escaped = entityText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const pattern = escaped.replace(/\s+/g, '[\\s\\u00A0\\t]+');
		const regex = new RegExp(pattern, 'gi');

		const isAlnum = (ch: string) => /[A-Za-z0-9À-ÿ]/.test(ch);
		const startsAlpha = isAlnum(entityText[0] || '');
		const endsAlpha = isAlnum(entityText[entityText.length - 1] || '');

		const newOccurrences = [] as PiiOccurrence[];
		let match: RegExpExecArray | null;
		while ((match = regex.exec(searchSource)) !== null) {
			const foundIndex = match.index;
			const foundLength = match[0].length;
			const plainTextStart = foundIndex;
			const plainTextEnd = foundIndex + foundLength;

			// Enforce word boundaries to avoid mid-token matches
			const beforeChar = plainTextStart > 0 ? searchSource[plainTextStart - 1] : '';
			const afterChar = plainTextEnd < searchSource.length ? searchSource[plainTextEnd] : '';
			if (startsAlpha && beforeChar && isAlnum(beforeChar)) {
				continue; // starts inside a word
			}
			if (endsAlpha && afterChar && isAlnum(afterChar)) {
				continue; // ends inside a word
			}

			const proseMirrorStart = mapping.plainTextToProseMirror.get(plainTextStart);
			const proseMirrorEnd = mapping.plainTextToProseMirror.get(plainTextEnd - 1);

			if (proseMirrorStart !== undefined && proseMirrorEnd !== undefined) {
				const from = proseMirrorStart;
				const to = proseMirrorEnd + 1;
				if (from >= 0 && to <= doc.content.size && from < to) {
					newOccurrences.push({ start_idx: from, end_idx: to });
				}
			}
		}

		return { ...entity, occurrences: newOccurrences };
	});

	return remappedEntities.filter((entity) => entity.occurrences.length > 0);
}

// Sync plugin state with session manager
function syncWithSessionManager(
	conversationId: string | undefined,
	piiSessionManager: typeof PiiSessionManager.prototype,
	currentEntities: ExtendedPiiEntity[],
	mapping: PositionMapping,
	doc: ProseMirrorNode
): ExtendedPiiEntity[] {
	// Get all entities from session manager using simplified display logic
	const sessionEntities = piiSessionManager.getEntitiesForDisplay(conversationId);

	// If session manager has fewer entities, some were removed
	if (sessionEntities.length < currentEntities.length) {
		// Don't filter entities if session manager is completely empty
		// This happens in new chat windows where session manager hasn't stored entities yet
		if (sessionEntities.length === 0) {
			// For new chats, just validate current entities without filtering
			return validateAndFilterEntities(currentEntities, doc, mapping);
		}

		// Filter current entities to only include those still in session manager
		const filteredEntities = currentEntities.filter((currentEntity) =>
			sessionEntities.find(
				(sessionEntity: ExtendedPiiEntity) => sessionEntity.label === currentEntity.label
			)
		);

		console.log('PiiDetectionExtension: Filtered entities:', {
			before: currentEntities.length,
			after: filteredEntities.length,
			removed: currentEntities
				.filter((c) => !filteredEntities.find((f) => f.label === c.label))
				.map((e) => e.label)
		});

		// Validate positions for remaining entities
		return validateAndFilterEntities(filteredEntities, doc, mapping);
	}

	// Sync shouldMask state: Use session manager state as source of truth
	const updatedEntities = currentEntities.map((currentEntity) => {
		const sessionEntity = sessionEntities.find(
			(e: ExtendedPiiEntity) => e.label === currentEntity.label
		);
		if (sessionEntity) {
			// Use session manager's shouldMask state
			return {
				...currentEntity,
				shouldMask: sessionEntity.shouldMask ?? true
			};
		}
		return currentEntity;
	});

	return validateAndFilterEntities(updatedEntities, doc, mapping);
}

// Create decorations for PII entities and modifier-affected text
function createPiiDecorations(
	entities: ExtendedPiiEntity[],
	modifiers: PiiModifier[],
	doc: ProseMirrorNode
): Decoration[] {
	const decorations: Decoration[] = [];

	// Build a fresh mapping for this render pass
	const mapping = buildPositionMapping(doc);
	const source = decodeHtmlEntities(mapping.plainText);

	// Helper for alnum
	const isAlnum = (ch: string) => /[A-Za-z0-9À-ÿ]/.test(ch);

	// Add PII entity decorations first (lower priority)
	type RawSpan = {
		type: string;
		label: string;
		shouldMask: boolean;
		from: number;
		to: number;
		entityIndex: number;
		occurrenceIndex: number;
	};
	const rawSpans: RawSpan[] = [];

	entities.forEach((entity, entityIndex) => {
		(entity.occurrences || []).forEach((occ, occurrenceIndex) => {
			const from = occ.start_idx;
			const to = occ.end_idx;
			if (from >= 0 && to <= doc.content.size && from < to) {
				rawSpans.push({
					type: entity.type,
					label: entity.label,
					shouldMask: entity.shouldMask ?? true,
					from,
					to,
					entityIndex,
					occurrenceIndex
				});
			}
		});
	});

	// Sort for stable rendering; do NOT merge spans to preserve indices for toggling
	rawSpans.sort((a, b) => (a.from === b.from ? a.to - b.to : a.from - b.from));
	rawSpans.forEach((span) => {
		const maskingClass = span.shouldMask ? 'pii-masked' : 'pii-unmasked';
		decorations.push(
			Decoration.inline(span.from, span.to, {
				class: `pii-highlight ${maskingClass}`,
				'data-pii-type': span.type,
				'data-pii-label': span.label,
				'data-pii-text': '',
				'data-pii-occurrence': String(span.occurrenceIndex),
				'data-should-mask': span.shouldMask.toString(),
				'data-entity-index': String(span.entityIndex)
			})
		);
	});

	// Add modifier decorations using plain-text matching and position mapping
	(modifiers || []).forEach((modifier) => {
		// Normalize modifier entity
		let text = decodeHtmlEntities(modifier.entity || '');
		text = text
			.normalize('NFKC')
			.replace(/^[\s\u00A0\t|:;.,\-_/\\]+/, '')
			.replace(/[\s\u00A0\t|:;.,\-_/\\]+$/, '');
		if (!text) return;

		const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const pattern = escaped.replace(/\s+/g, '[\s\u00A0\t]+');
		const regex = new RegExp(pattern, 'gi');

		const startsAlpha = isAlnum(text[0] || '');
		const endsAlpha = isAlnum(text[text.length - 1] || '');

		// Helper: tolerant mapping from plain index to PM position
		const mapStartInRange = (startIdx: number, endIdx: number): number | undefined => {
			// Find first mappable plain index within [startIdx, endIdx)
			for (let i = startIdx; i < endIdx; i++) {
				const pm = mapping.plainTextToProseMirror.get(i);
				if (pm !== undefined) return pm;
			}
			return undefined;
		};
		const mapEndInRange = (startIdx: number, endIdx: number): number | undefined => {
			// Find last mappable plain index within [startIdx, endIdx)
			for (let i = endIdx - 1; i >= startIdx; i--) {
				const pm = mapping.plainTextToProseMirror.get(i);
				if (pm !== undefined) return pm;
			}
			return undefined;
		};

		let match: RegExpExecArray | null;
		while ((match = regex.exec(source)) !== null) {
			const start = match.index;
			const end = start + match[0].length;
			const before = start > 0 ? source[start - 1] : '';
			const after = end < source.length ? source[end] : '';
			if (startsAlpha && before && isAlnum(before)) continue;
			if (endsAlpha && after && isAlnum(after)) continue;

			const pmStart = mapStartInRange(start, end);
			const pmEnd = mapEndInRange(start, end);
			if (pmStart === undefined || pmEnd === undefined) continue;
			const from = pmStart;
			const to = pmEnd + 1;
			if (!(from >= 0 && to <= doc.content.size && from < to)) continue;

			const decorationClass =
				modifier.action === 'string-mask'
					? 'pii-modifier-highlight pii-modifier-mask'
					: 'pii-modifier-highlight pii-modifier-ignore';

			decorations.push(
				Decoration.inline(from, to, {
					class: decorationClass,
					'data-modifier-entity': modifier.entity,
					'data-modifier-action': modifier.action,
					'data-modifier-type': modifier.type || '',
					'data-modifier-id': modifier.id,
					style: 'z-index: 10; position: relative;'
				})
			);
		}
	});

	return decorations;
}

const piiDetectionPluginKey = new PluginKey<PiiDetectionState>('piiDetection');

export const PiiDetectionExtension = Extension.create<PiiDetectionOptions>({
	name: 'piiDetection',

	addOptions() {
		return {
			enabled: false,
			apiKey: '',
			conversationId: '',
			getShouldMask: () => true, // Default to masked for backward compatibility
			onPiiDetected: undefined,
			onPiiToggled: undefined,
			onPiiDetectionStateChanged: undefined,
			debounceMs: 500,
			detectOnlyAfterUserEdit: false
		};
	},

	addProseMirrorPlugins() {
		const options = this.options;
		const { enabled, apiKey, onPiiDetected, debounceMs } = options;

		if (!enabled || !apiKey) {
			return [];
		}

		console.log('PiiDetectionExtension: initialized', {
			conversationId: options.conversationId,
			enabled,
			hasApiKey: !!apiKey,
			debounceMs: debounceMs || 500
		});

		const piiSessionManager = PiiSessionManager.getInstance();
		piiSessionManager.setApiKey(apiKey);

		const performPiiDetection = async (plainText: string) => {
			if (!plainText.trim()) {
				return;
			}

			try {
				// Set detecting state to true at the start
				const editorView = this.editor?.view;
				if (editorView) {
					const tr = editorView.state.tr.setMeta(piiDetectionPluginKey, {
						type: 'SET_DETECTING',
						isDetecting: true
					});
					editorView.dispatch(tr);
				}

				const knownEntities = piiSessionManager.getKnownEntitiesForApi(options.conversationId);

				const modifiers = piiSessionManager.getModifiersForApi(options.conversationId);
				const response = await maskPiiText(
					apiKey,
					[plainText],
					knownEntities,
					modifiers,
					false,
					false
				);

				if (response.pii && response.pii[0] && response.pii[0].length > 0) {
					const editorView = this.editor?.view;
					const state = piiDetectionPluginKey.getState(editorView?.state);

					if (!editorView || !state?.positionMapping) {
						console.warn('PiiDetectionExtension: No editor view or position mapping available');
						return;
					}

					// CRITICAL FIX: Load conversation entities for cross-message shouldMask persistence
					// This ensures that entities unmasked in previous messages stay unmasked in new messages
					// For new chats, load from temporary state instead of empty array
					const conversationEntities = piiSessionManager.getEntitiesForDisplay(
						options.conversationId
					);

					// CRITICAL FIX: Merge plugin state + conversation state for complete context
					// Plugin state takes precedence (for same-message interactions)
					// Conversation state provides fallback (for cross-message persistence)
					const pluginEntities = state.entities || [];
					const existingEntitiesForMapping = [...pluginEntities];

					// Add conversation entities that aren't already in plugin state
					conversationEntities.forEach((convEntity) => {
						if (!pluginEntities.find((pluginEntity) => pluginEntity.label === convEntity.label)) {
							existingEntitiesForMapping.push(convEntity);
						}
					});

					console.log('PiiDetectionExtension: Using existing entities for mapping:', {
						pluginEntities: pluginEntities.length,
						conversationEntities: conversationEntities.length,
						totalForMapping: existingEntitiesForMapping.length,
						labels: existingEntitiesForMapping.map((e) => `${e.label}:${e.shouldMask}`)
					});

					// Pass merged entities to preserve shouldMask state across messages
					const mappedEntities = mapPiiEntitiesToProseMirror(
						response.pii[0],
						state.positionMapping,
						existingEntitiesForMapping,
						options.getShouldMask ? options.getShouldMask() : true
					);

					// CRITICAL FIX: Sync the mapped entities back to session manager
					// This ensures session manager has the correct shouldMask states from plugin
					if (options.conversationId) {
						piiSessionManager.setConversationWorkingEntitiesWithMaskStates(
							options.conversationId,
							mappedEntities
						);
					} else {
						// For new chats, use temporary state
						if (!piiSessionManager.isTemporaryStateActive()) {
							piiSessionManager.activateTemporaryState();
						}
						piiSessionManager.setTemporaryStateEntities(mappedEntities);
					}

					const tr = editorView.state.tr.setMeta(piiDetectionPluginKey, {
						type: 'UPDATE_ENTITIES',
						entities: mappedEntities
					});

					editorView.dispatch(tr);

					if (onPiiDetected) {
						onPiiDetected(mappedEntities, response.text[0]);
					}
				}
			} catch (error) {
				console.error('PiiDetectionExtension: PII detection failed:', error);
			} finally {
				// Set detecting state to false when done (success or error)
				const editorView = this.editor?.view;
				if (editorView) {
					const tr = editorView.state.tr.setMeta(piiDetectionPluginKey, {
						type: 'SET_DETECTING',
						isDetecting: false
					});
					editorView.dispatch(tr);
				}
			}
		};

		// Debounced version
		const debouncedDetection = debounce(performPiiDetection, debounceMs || 500);

		const plugin = new Plugin<PiiDetectionState>({
			key: piiDetectionPluginKey,

			state: {
				init(): PiiDetectionState {
					return {
						entities: [],
						positionMapping: null,
						isDetecting: false,
						lastText: '',
						needsSync: false
					};
				},

				apply(tr, prevState): PiiDetectionState {
					const newState = { ...prevState };

					const meta = tr.getMeta(piiDetectionPluginKey);
					if (meta) {
						console.log('PiiDetectionExtension: meta action', meta.type);
						switch (meta.type) {
							case 'SET_USER_EDITED':
								newState.userEdited = true;
								break;
							case 'SET_DETECTING':
								newState.isDetecting = meta.isDetecting;
								// Call the callback to notify parent component
								if (options.onPiiDetectionStateChanged) {
									options.onPiiDetectionStateChanged(meta.isDetecting);
								}
								break;

							case 'UPDATE_ENTITIES':
								// Recompute occurrences against current document to avoid shifted offsets
								// (e.g., when original indices were based on markdown source rather than rendered doc)
								if (meta.entities && meta.entities.length) {
									const mapping = newState.positionMapping || buildPositionMapping(tr.doc);
									const remapped = remapEntitiesForCurrentDocument(meta.entities, mapping, tr.doc);
									newState.entities = validateAndFilterEntities(remapped, tr.doc, mapping);
									newState.entities = resolveOverlaps(newState.entities, tr.doc);
								} else {
									newState.entities = [];
								}
								break;

							case 'SYNC_WITH_SESSION_MANAGER': {
								// Always sync from session manager to get latest state
								const currentMapping = newState.positionMapping || buildPositionMapping(tr.doc);
								const sessionEntities = piiSessionManager.getEntitiesForDisplay(
									options.conversationId
								);

								// Always use session entities as source of truth when syncing
								if (sessionEntities.length > 0) {
									// Remap session entities to current doc positions
									const remapped = remapEntitiesForCurrentDocument(
										sessionEntities,
										currentMapping,
										tr.doc
									);
									newState.entities = validateAndFilterEntities(remapped, tr.doc, currentMapping);
									newState.entities = resolveOverlaps(newState.entities, tr.doc);
								} else if (newState.entities.length > 0) {
									// If session is empty but we have entities, sync them to session
									newState.entities = syncWithSessionManager(
										options.conversationId,
										piiSessionManager,
										newState.entities,
										currentMapping,
										tr.doc
									);
									// Persist current plugin entities to session for future lookups
									if (options.conversationId) {
										piiSessionManager.setConversationWorkingEntitiesWithMaskStates(
											options.conversationId,
											newState.entities
										);
									} else {
										if (!piiSessionManager.isTemporaryStateActive()) {
											piiSessionManager.activateTemporaryState();
										}
										piiSessionManager.setTemporaryStateEntities(newState.entities);
									}
								}
								break;
							}

							case 'TOGGLE_ENTITY_MASKING': {
								const { entityIndex, occurrenceIndex } = meta;
								if (newState.entities[entityIndex]) {
									const entity = { ...newState.entities[entityIndex] };
									entity.shouldMask = !entity.shouldMask;
									newState.entities = [...newState.entities];
									newState.entities[entityIndex] = entity;

									const piiSessionManager = PiiSessionManager.getInstance();

									// Ensure the entity exists in session state before toggling
									const sessionEntitiesBefore = piiSessionManager.getEntitiesForDisplay(
										options.conversationId
									);
									if (!sessionEntitiesBefore.find((e: any) => e.label === entity.label)) {
										if (options.conversationId) {
											piiSessionManager.setConversationWorkingEntitiesWithMaskStates(
												options.conversationId,
												newState.entities
											);
										} else {
											if (!piiSessionManager.isTemporaryStateActive()) {
												piiSessionManager.activateTemporaryState();
											}
											piiSessionManager.setTemporaryStateEntities(newState.entities);
										}
									}

									piiSessionManager.toggleEntityMasking(
										entity.label,
										occurrenceIndex,
										options.conversationId
									);

									// CRITICAL FIX: Mark that we need to sync with session manager on next transaction
									// This ensures that subsequent detections use the correct shouldMask state
									newState.needsSync = true;

									if (options.onPiiToggled) {
										options.onPiiToggled(newState.entities);
									}
								}
								break;
							}

							case 'TRIGGER_DETECTION':
							case 'TRIGGER_DETECTION_WITH_MODIFIERS': {
								const currentMapping = buildPositionMapping(tr.doc);
								newState.positionMapping = currentMapping;

								if (currentMapping.plainText.trim()) {
									performPiiDetection(currentMapping.plainText);
								}
								break;
							}

							case 'RELOAD_CONVERSATION_STATE': {
								options.conversationId = meta.conversationId;

								const newMapping = buildPositionMapping(tr.doc);
								newState.positionMapping = newMapping;

								// Populate entities from session immediately without triggering detection
								const sessionEntities = piiSessionManager.getEntitiesForDisplay(
									options.conversationId
								);
								if (sessionEntities.length) {
									const remapped = remapEntitiesForCurrentDocument(
										sessionEntities,
										newMapping,
										tr.doc
									);
									newState.entities = validateAndFilterEntities(remapped, tr.doc, newMapping);
									newState.entities = resolveOverlaps(newState.entities, tr.doc);
								}
								break;
							}
						}
					}

					if (tr.docChanged) {
						const newMapping = buildPositionMapping(tr.doc);
						const textActuallyChanged =
							newMapping.plainText !== prevState.positionMapping?.plainText;

						// Update position mapping
						newState.positionMapping = newMapping;

						if (textActuallyChanged) {
							console.log(
								'PiiDetectionExtension: Text actually changed, length:',
								newMapping.plainText.length
							);
						}

						// Remap entities based on whether text changed
						if (textActuallyChanged) {
							// Text changed: remap existing entities to current document positions
							if (newState.entities.length > 0) {
								// First, try to remap entities to current positions
								const remappedEntities = remapEntitiesForCurrentDocument(
									newState.entities,
									newState.positionMapping,
									tr.doc
								);

								// Then sync with session manager for external changes
								newState.entities = syncWithSessionManager(
									options.conversationId,
									piiSessionManager,
									remappedEntities,
									newState.positionMapping,
									tr.doc
								);
								newState.entities = resolveOverlaps(newState.entities, tr.doc);
							} else {
								// If we have no entities yet, populate from session if available
								const sessionEntities = piiSessionManager.getEntitiesForDisplay(
									options.conversationId
								);
								if (sessionEntities.length) {
									const remapped = remapEntitiesForCurrentDocument(
										sessionEntities,
										newState.positionMapping,
										tr.doc
									);
									newState.entities = validateAndFilterEntities(
										remapped,
										tr.doc,
										newState.positionMapping
									);
									newState.entities = resolveOverlaps(newState.entities, tr.doc);
								}
							}
						} else {
							// Text hasn't changed but doc changed (likely due to decoration updates)
							// Still sync with session manager to get latest shouldMask states
							if (newState.entities.length > 0) {
								newState.entities = syncWithSessionManager(
									options.conversationId,
									piiSessionManager,
									newState.entities,
									newState.positionMapping,
									tr.doc
								);
							}

							// CRITICAL FIX: If we need to sync after toggle, do it now BEFORE detection
							// This ensures shouldMask state is consistent before next detection
							if (newState.needsSync) {
								newState.entities = syncWithSessionManager(
									options.conversationId,
									piiSessionManager,
									newState.entities,
									newState.positionMapping,
									tr.doc
								);
								newState.needsSync = false;
							}

							// Trigger detection if text changed significantly
							if (
								!newState.isDetecting &&
								newMapping.plainText !== newState.lastText &&
								(!options.detectOnlyAfterUserEdit || newState.userEdited)
							) {
								newState.lastText = newMapping.plainText;

								if (newMapping.plainText.trim()) {
									debouncedDetection(newMapping.plainText);
								} else {
									// If text is empty, clear entities
									newState.entities = [];
								}
							}
						}
					}

					return newState;
				}
			},

			props: {
				decorations(state) {
					const pluginState = piiDetectionPluginKey.getState(state);

					// Get modifiers from session manager (not ProseMirror extension state)
					const piiSessionManager = PiiSessionManager.getInstance();
					const modifiers = piiSessionManager.getModifiersForDisplay(options.conversationId);

					// If no entities yet, pull from session to allow immediate rendering
					if (!pluginState?.entities.length) {
						const sessionEntities = piiSessionManager.getEntitiesForDisplay(options.conversationId);
						if (sessionEntities.length) {
							const mapping = buildPositionMapping(state.doc);
							const remapped = remapEntitiesForCurrentDocument(sessionEntities, mapping, state.doc);
							const validated = validateAndFilterEntities(remapped, state.doc, mapping);

							// Create decorations for these remapped entities + modifiers
							const decorations = createPiiDecorations(validated, modifiers, state.doc);
							return DecorationSet.create(state.doc, decorations);
						}
					}
					if (!pluginState?.entities.length && !modifiers.length) {
						return DecorationSet.empty;
					}

					const decorations = createPiiDecorations(
						pluginState?.entities || [],
						modifiers,
						state.doc
					);
					return DecorationSet.create(state.doc, decorations);
				},

				handleClick(view, pos, event) {
					const target = event.target as HTMLElement;

					if (target.classList.contains('pii-highlight')) {
						const entityIndex = parseInt(target.getAttribute('data-entity-index') || '0');
						const occurrenceIndex = parseInt(target.getAttribute('data-pii-occurrence') || '0');

						const tr = view.state.tr.setMeta(piiDetectionPluginKey, {
							type: 'TOGGLE_ENTITY_MASKING',
							entityIndex,
							occurrenceIndex
						});

						view.dispatch(tr);
						event.preventDefault();
						return true;
					}

					return false;
				}
			}
		});

		return [plugin];
	},

	addCommands() {
		const options = this.options;

		// Helper function to update all entity masking states (DRY)
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const updateAllEntityMaskingStates =
			(shouldMask: boolean) =>
			({ state, dispatch }: any) => {
				const pluginState = piiDetectionPluginKey.getState(state);
				if (!pluginState?.entities.length) {
					return false; // No entities to update
				}

				const piiSessionManager = PiiSessionManager.getInstance();

				// Get current entities using the proper display method
				const currentEntities = piiSessionManager.getEntitiesForDisplay(options.conversationId);

				if (!currentEntities.length) {
					return false; // No entities in session manager
				}

				// Update session manager based on state type
				if (piiSessionManager.isTemporaryStateActive()) {
					// Handle temporary state (new chats)
					const updatedEntities = currentEntities.map((entity: ExtendedPiiEntity) => ({
						...entity,
						shouldMask
					}));
					piiSessionManager.setTemporaryStateEntities(updatedEntities);
				} else if (options.conversationId) {
					// Handle conversation state - update each entity individually for proper persistence
					currentEntities.forEach((entity: ExtendedPiiEntity) => {
						piiSessionManager.setEntityMaskingState(
							options.conversationId!,
							entity.label,
							shouldMask
						);
					});
				}

				// Create updated entities for plugin state
				const updatedPluginEntities = pluginState.entities.map((entity: ExtendedPiiEntity) => ({
					...entity,
					shouldMask
				}));

				// Update plugin state
				if (dispatch) {
					const tr = state.tr.setMeta(piiDetectionPluginKey, {
						type: 'UPDATE_ENTITIES',
						entities: updatedPluginEntities
					});
					dispatch(tr);

					// Trigger onPiiToggled callback
					if (options.onPiiToggled) {
						options.onPiiToggled(updatedPluginEntities);
					}
				}

				return true;
			};

		return {
			// Mark that the user edited the document (used to gate auto-detection on load)
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			markUserEdited:
				() =>
				({ state, dispatch }: any) => {
					if (!dispatch) return false;
					const tr = state.tr.setMeta(piiDetectionPluginKey, { type: 'SET_USER_EDITED' });
					dispatch(tr);
					return true;
				},
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			triggerDetection:
				() =>
				({ state, dispatch }: any) => {
					if (dispatch) {
						const tr = state.tr.setMeta(piiDetectionPluginKey, {
							type: 'TRIGGER_DETECTION'
						});
						dispatch(tr);
						return true;
					}
					return false;
				},

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			triggerDetectionForModifiers:
				() =>
				({ state, dispatch }: any) => {
					if (dispatch) {
						const tr = state.tr.setMeta(piiDetectionPluginKey, {
							type: 'TRIGGER_DETECTION_WITH_MODIFIERS'
						});
						dispatch(tr);
						return true;
					}
					return false;
				},

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			syncWithSessionManager:
				() =>
				({ state, dispatch }: any) => {
					if (dispatch) {
						const tr = state.tr.setMeta(piiDetectionPluginKey, {
							type: 'SYNC_WITH_SESSION_MANAGER'
						});
						dispatch(tr);
						return true;
					}
					return false;
				},

			// Force immediate entity remapping and decoration update
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			forceEntityRemapping:
				() =>
				({ state, dispatch }: any) => {
					const pluginState = piiDetectionPluginKey.getState(state);

					if (!pluginState?.entities.length || !dispatch) {
						return false;
					}

					// Build current position mapping
					const mapping = buildPositionMapping(state.doc);

					// Remap entities to current positions
					const remappedEntities = remapEntitiesForCurrentDocument(
						pluginState.entities,
						mapping,
						state.doc
					);

					// Update plugin state with remapped entities
					const tr = state.tr.setMeta(piiDetectionPluginKey, {
						type: 'UPDATE_ENTITIES',
						entities: remappedEntities
					});

					dispatch(tr);
					return true;
				},

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			reloadConversationState:
				(newConversationId: string) =>
				({ state, dispatch }: any) => {
					if (dispatch) {
						const tr = state.tr.setMeta(piiDetectionPluginKey, {
							type: 'RELOAD_CONVERSATION_STATE',
							conversationId: newConversationId
						});
						dispatch(tr);
						return true;
					}
					return false;
				},

			// Unmask all PII entities
			unmaskAllEntities: () => updateAllEntityMaskingStates(false),

			// Mask all PII entities
			maskAllEntities: () => updateAllEntityMaskingStates(true)
		};
	}
});
