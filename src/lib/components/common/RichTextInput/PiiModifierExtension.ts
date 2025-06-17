import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { PiiSessionManager } from '$lib/utils/pii';

// Types for the Shield API modifiers
export type ModifierAction = 'ignore' | 'mask';

export interface PiiModifier {
	action: ModifierAction;
	entity: string;
	type?: string; // Required for 'mask' action
	id: string; // Unique identifier for this modifier
	from: number; // ProseMirror position start
	to: number; // ProseMirror position end
}

// Options for the extension
export interface PiiModifierOptions {
	enabled: boolean;
	conversationId?: string; // Add conversation ID for session manager lookup
	onModifiersChanged?: (modifiers: PiiModifier[]) => void;
	availableTypes?: string[]; // List of available PII types for mask action
}

// Extension state
interface PiiModifierState {
	modifiers: PiiModifier[];
	hoveredWordInfo: {
		word: string;
		from: number;
		to: number;
		x: number;
		y: number;
	} | null;
}

const piiModifierExtensionKey = new PluginKey<PiiModifierState>('piiModifier');

// Export the plugin key so other extensions can access the state
export { piiModifierExtensionKey };

// Generate unique ID for modifiers
function generateModifierId(): string {
	return `modifier_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}



// Extract text content from a selection range
function getSelectionText(doc: ProseMirrorNode, from: number, to: number): string {
	let text = '';
	
	doc.nodesBetween(from, to, (node, pos) => {
		if (node.isText && node.text) {
			const start = Math.max(0, from - pos);
			const end = Math.min(node.text.length, to - pos);
			if (start < end) {
				text += node.text.substring(start, end);
			}
		} else if (node.type.name === 'paragraph' && text.length > 0) {
			text += ' '; // Add space between paragraphs
		} else if (node.type.name === 'hard_break') {
			text += ' '; // Add space for line breaks
		}
	});
	
	return text.trim();
}

// Trim spaces from selection and adjust positions accordingly
function trimSelectionSpaces(doc: ProseMirrorNode, from: number, to: number): { from: number; to: number; text: string } {
	let originalText = '';
	
	// Extract the original text first
	doc.nodesBetween(from, to, (node, pos) => {
		if (node.isText && node.text) {
			const start = Math.max(0, from - pos);
			const end = Math.min(node.text.length, to - pos);
			if (start < end) {
				originalText += node.text.substring(start, end);
			}
		} else if (node.type.name === 'paragraph' && originalText.length > 0) {
			originalText += ' '; // Add space between paragraphs
		} else if (node.type.name === 'hard_break') {
			originalText += ' '; // Add space for line breaks
		}
	});
	
	// Find leading and trailing spaces
	const leadingSpaces = originalText.length - originalText.trimStart().length;
	const trailingSpaces = originalText.length - originalText.trimEnd().length;
	const trimmedText = originalText.trim();
	
	// Adjust positions by removing leading and trailing spaces
	const adjustedFrom = from + leadingSpaces;
	const adjustedTo = to - trailingSpaces;
	
	return {
		from: adjustedFrom,
		to: adjustedTo,
		text: trimmedText
	};
}

/**
 * Simple tokenizer that expands selection to whole word boundaries
 * Uses a much simpler approach to avoid character merging issues
 */
function expandSelectionToWordBoundaries(doc: ProseMirrorNode, from: number, to: number): { from: number; to: number; text: string } {
	// Get the original selected text
	const originalText = getSelectionText(doc, from, to);
	
	// Start with the original selection boundaries
	let newFrom = from;
	let newTo = to;
	
	// Define word character regex including German umlauts and eszett
	const wordCharRegex = /[\w'-äöüÄÖÜß]/;
	
	// Expand backwards: keep going while the character before newFrom is a word character
	while (newFrom > 0) {
		const charBefore = getSelectionText(doc, newFrom - 1, newFrom);
		if (!wordCharRegex.test(charBefore)) {
			break; // Hit a non-word character, stop here
		}
		newFrom--;
	}
	
	// Expand forwards: keep going while the character at newTo is a word character
	while (newTo < doc.content.size) {
		const charAt = getSelectionText(doc, newTo, newTo + 1);
		if (!wordCharRegex.test(charAt)) {
			break; // Hit a non-word character, stop here
		}
		newTo++;
	}
	
	// Get the expanded text
	const expandedText = getSelectionText(doc, newFrom, newTo);
	
	console.log('PiiModifierExtension: Simple tokenizer result:', {
		original: { from, to, text: originalText },
		expanded: { from: newFrom, to: newTo, text: expandedText },
		steps: {
			startFrom: from,
			expandedBackTo: newFrom,
			startTo: to,
			expandedForwardTo: newTo
		}
	});
	
	return {
		from: newFrom,
		to: newTo,
		text: expandedText
	};
}

/**
 * Advanced tokenizer that handles multiple words and validates tokens
 */
function tokenizeSelection(doc: ProseMirrorNode, from: number, to: number): { from: number; to: number; text: string; tokens: string[] } {
	// Safety check for valid positions
	if (from < 0 || to > doc.content.size || from >= to) {
		console.warn('PiiModifierExtension: Invalid tokenization positions:', { from, to, docSize: doc.content.size });
		return {
			from: from,
			to: to,
			text: '',
			tokens: []
		};
	}
	
	// Expand to word boundaries using the simple approach
	const expanded = expandSelectionToWordBoundaries(doc, from, to);
	
	// Safety check for expanded result
	if (!expanded.text || expanded.text.length === 0) {
		console.warn('PiiModifierExtension: Tokenization resulted in empty text');
		return {
			...expanded,
			tokens: []
		};
	}
	
	// Tokenize the expanded text into individual words
	const tokens = expanded.text
		.split(/\s+/) // Split on whitespace
		.filter(token => token.length > 0) // Remove empty tokens
		.map(token => token.trim()); // Trim each token
	
	// Validate that we have reasonable tokens (including German characters)
	const validTokens = tokens.filter(token => {
		// Must contain at least one word character (including German umlauts/eszett) and be at least 2 characters
		return /[\w'-äöüÄÖÜß]/.test(token) && token.length >= 2;
	});
	
	console.log('PiiModifierExtension: Tokenized selection:', {
		input: { from, to, text: getSelectionText(doc, from, to) },
		expanded: expanded,
		tokens: tokens,
		validTokens: validTokens
	});
	
	return {
		...expanded, // Use expanded positions and text directly
		tokens: validTokens
	};
}

// Check if any position in a range conflicts with existing modifiers or PII
function hasConflictInRange(view: any, from: number, to: number): boolean {
	// Import the PiiDetectionExtension plugin key (we'll need to adjust import if needed)
	try {
		// Check for existing modifiers in plugin state
		const modifierPluginState = piiModifierExtensionKey.getState(view.state);
		if (modifierPluginState?.modifiers) {
			for (const modifier of modifierPluginState.modifiers) {
				// Check for overlap with existing modifiers
				if ((from >= modifier.from && from < modifier.to) || 
					(to > modifier.from && to <= modifier.to) ||
					(from <= modifier.from && to >= modifier.to)) {
					console.log('PiiModifierExtension: Conflict with existing modifier:', modifier);
					return true;
				}
			}
		}
		
		// Also check decorations to catch PII entities from PiiDetectionExtension
		// Get all decorations in the range
		const decorations = view.state.selection.decorationsAround || [];
		const doc = view.state.doc;
		
		// Look for PII highlighting decorations that overlap with our range
		doc.nodesBetween(Math.max(0, from - 50), Math.min(doc.content.size, to + 50), (node: any, pos: number) => {
			if (node.isText) {
				// Check if this text node has PII decorations that overlap with our range
				const nodeStart = pos;
				const nodeEnd = pos + (node.text?.length || 0);
				
				// If this text node overlaps with our target range
				if ((from >= nodeStart && from < nodeEnd) || 
					(to > nodeStart && to <= nodeEnd) ||
					(from <= nodeStart && to >= nodeEnd)) {
					
					// Check if there are PII decorations on this node
					const piiElements = view.dom.querySelectorAll('.pii-highlight');
					for (const element of piiElements) {
						// Get element's text content and check if it matches our range
						const elementText = element.textContent;
						if (elementText) {
							const docText = getSelectionText(doc, from, to);
							// If there's any overlap in the text content, we have a conflict
							if (docText.toLowerCase().includes(elementText.toLowerCase()) || 
								elementText.toLowerCase().includes(docText.toLowerCase())) {
								console.log('PiiModifierExtension: Conflict with existing PII highlighting:', elementText);
								return true; // Found conflict
							}
						}
					}
				}
			}
		});
		
	} catch (error) {
		console.log('PiiModifierExtension: Error checking conflicts:', error);
		// If we can't check properly, be conservative and allow the operation
	}
	
	return false;
}

// Validate selection for modifier creation
function validateSelection(view: any, from: number, to: number): { valid: boolean; text: string } {
	const doc = view.state.doc;
	const text = getSelectionText(doc, from, to);
	
	// Must have meaningful text (at least 2 characters)
	if (!text || text.length < 2) {
		return { valid: false, text: '' };
	}
	
	// Must not conflict with existing modifiers or PII
	if (hasConflictInRange(view, from, to)) {
		return { valid: false, text };
	}
	
	return { valid: true, text };
}


// Find existing PII or modifier element under mouse cursor
function findExistingEntityAtPosition(view: any, clientX: number, clientY: number): { from: number; to: number; text: string; type: 'pii' | 'modifier' } | null {
	const target = document.elementFromPoint(clientX, clientY) as HTMLElement;
	if (!target) return null;

	// Check if we're hovering over a PII highlight
	const piiElement = target.closest('.pii-highlight');
	if (piiElement) {
		const piiText = piiElement.getAttribute('data-pii-text') || piiElement.textContent || '';
		const piiLabel = piiElement.getAttribute('data-pii-label') || '';
		if (piiText.length >= 2) {
			// Try to find the exact position using PII plugin state
			try {
				// We need to import the PII detection plugin key to access its state
				const piiDetectionPluginKey = new PluginKey('piiDetection');
				const piiState = piiDetectionPluginKey.getState(view.state);
				
				if (piiState?.entities) {
					// Find the entity that matches this label
					const matchingEntity = piiState.entities.find((entity: any) => entity.label === piiLabel);
					if (matchingEntity && matchingEntity.occurrences.length > 0) {
						const occurrence = matchingEntity.occurrences[0]; // Use first occurrence
						return {
							from: occurrence.start_idx,
							to: occurrence.end_idx,
							text: piiText,
							type: 'pii'
						};
					}
				}
			} catch (error) {
				console.log('PiiModifierExtension: Could not access PII state:', error);
			}
			
			// Fallback: get position from mouse and estimate range
			const pos = view.posAtCoords({ left: clientX, top: clientY });
			if (pos) {
				const textLength = piiText.length;
				return {
					from: Math.max(0, pos.pos - Math.floor(textLength / 2)),
					to: Math.min(view.state.doc.content.size, pos.pos + Math.ceil(textLength / 2)),
					text: piiText,
					type: 'pii'
				};
			}
		}
	}

	// Check if we're hovering over a modifier highlight
	const modifierElement = target.closest('.pii-modifier-highlight');
	if (modifierElement) {
		const modifierText = modifierElement.getAttribute('data-modifier-entity') || modifierElement.textContent || '';
		if (modifierText.length >= 2) {
			// Try to find the exact position using modifier plugin state
			try {
				const modifierState = piiModifierExtensionKey.getState(view.state);
				if (modifierState?.modifiers) {
					// Find the modifier that matches this entity text
					const matchingModifier = modifierState.modifiers.find((modifier: any) => 
						modifier.entity.toLowerCase() === modifierText.toLowerCase()
					);
					if (matchingModifier) {
						return {
							from: matchingModifier.from,
							to: matchingModifier.to,
							text: modifierText,
							type: 'modifier'
						};
					}
				}
			} catch (error) {
				console.log('PiiModifierExtension: Could not access modifier state:', error);
			}
			
			// Fallback: get position from mouse and estimate range
			const pos = view.posAtCoords({ left: clientX, top: clientY });
			if (pos) {
				const textLength = modifierText.length;
				return {
					from: Math.max(0, pos.pos - Math.floor(textLength / 2)),
					to: Math.min(view.state.doc.content.size, pos.pos + Math.ceil(textLength / 2)),
					text: modifierText,
					type: 'modifier'
				};
			}
		}
	}

	return null;
}

// Predefined PII labels for autocompletion (from SPACY_LABEL_MAPPINGS values)
const PREDEFINED_LABEL_TYPES = [
	'ADDRESS', 'BANK_ACCOUNT_NUMBER', 'ID_NUMBER', 'HEALTH_DATA', 'LOCATION', 
	'NUMBER', 'TAX_NUMBER', 'CREDIT_CARD', 'DATE', 'SIGNATURE', 'EMAIL', 
	'IBAN', 'HEALTH_ID', 'IPv4v6', 'PHONENUMBER', 'LICENSE_PLATE', 'CURRENCY', 
	'ORGANISATION', 'PASSPORT', 'PERSON', 'SSN'
];

// Find best matching label for inline completion
function findBestMatch(input: string, labels: string[]): string | null {
	if (!input) return null;
	
	const upperInput = input.toUpperCase();
	
	// Only find exact prefix matches - autocomplete should only suggest words that start with the input
	const exactMatch = labels.find(label => label.startsWith(upperInput));
	if (exactMatch) return exactMatch;
	
	// No partial/substring matching - let user type what they want
	return null;
}

// Create hover menu element
function createHoverMenu(
	wordInfo: { word: string; from: number; to: number; x: number; y: number },
	onIgnore: () => void,
	onMask: (type: string, useOriginalSelection?: boolean) => void,
	showIgnoreButton: boolean = false,
	existingModifiers: PiiModifier[] = [],
	onRemoveModifier?: (modifierId: string) => void,
	timeoutManager?: { clearAll: () => void; setFallback: (callback: () => void, delay: number) => void },
	showTextField: boolean = true,
	originalSelection?: { word: string; from: number; to: number } // Add original selection info
): HTMLElement {
	const menu = document.createElement('div');
	menu.className = 'pii-modifier-hover-menu';
	menu.style.cssText = `
		position: fixed;
		left: ${Math.min(wordInfo.x, window.innerWidth - 250)}px;
		top: ${wordInfo.y - 80}px;
		background: white;
		border: 1px solid #ddd;
		border-radius: 8px;
		box-shadow: 0 4px 20px rgba(0,0,0,0.15);
		padding: 12px;
		z-index: 1000;
		font-family: system-ui, -apple-system, sans-serif;
		font-size: 13px;
		min-width: 220px;
		max-width: 300px;
	`;

	// Header with icon
	const header = document.createElement('div');
	header.style.cssText = `
		display: flex;
		align-items: center;
		gap: 8px;
		font-weight: 600;
		color: #333;
		margin-bottom: 8px;
		font-size: 12px;
	`;
	
	// Add NENNA icon
	const icon = document.createElement('img');
	icon.src = '/static/icon-purple-32.png';
	icon.style.cssText = `
		width: 16px;
		height: 16px;
		flex-shrink: 0;
	`;
	
	const textNode = document.createElement('span');
	// Truncate long multi-word entities for display
	const displayText = wordInfo.word.length > 30 ? wordInfo.word.substring(0, 30) + '...' : wordInfo.word;
	textNode.textContent = `"${displayText}"`;
	textNode.title = wordInfo.word; // Full text in tooltip
	
	header.appendChild(icon);
	header.appendChild(textNode);
	menu.appendChild(header);

	// Show existing modifier if any (simplified - one modifier per entity)
	if (existingModifiers.length > 0) {
		const modifier = existingModifiers[0]; // Only show the first (and should be only) modifier
		const modifierLine = document.createElement('div');
		modifierLine.style.cssText = `
			display: flex;
			justify-content: space-between;
			align-items: center;
			padding: 6px 8px;
			margin-bottom: 8px;
			background: #f8f9fa;
			border-radius: 4px;
			border: 1px solid #e9ecef;
			font-size: 12px;
		`;

		const modifierInfo = document.createElement('span');
		const typeIcon = modifier.action === 'ignore' ? '🚫' : '🏷️';
		const typeText = modifier.action === 'ignore' ? 'Ignored' : modifier.type;
		modifierInfo.textContent = `${typeIcon} ${typeText}`;
		modifierInfo.style.cssText = `
			color: #495057;
			flex: 1;
			font-weight: 500;
		`;

		const removeBtn = document.createElement('button');
		removeBtn.textContent = '✕';
		removeBtn.title = 'Remove modifier';
		removeBtn.style.cssText = `
			background: #dc3545;
			color: white;
			border: none;
			border-radius: 2px;
			width: 16px;
			height: 16px;
			cursor: pointer;
			font-size: 10px;
			display: flex;
			align-items: center;
			justify-content: center;
			flex-shrink: 0;
			margin-left: 8px;
		`;

		removeBtn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			if (onRemoveModifier) {
				onRemoveModifier(modifier.id);
			}
		});

		removeBtn.addEventListener('mouseenter', () => {
			removeBtn.style.backgroundColor = '#c82333';
		});

		removeBtn.addEventListener('mouseleave', () => {
			removeBtn.style.backgroundColor = '#dc3545';
		});

		modifierLine.appendChild(modifierInfo);
		modifierLine.appendChild(removeBtn);
		menu.appendChild(modifierLine);
	}

	// Ignore button (only show if word is detected as PII)
	if (showIgnoreButton) {
		const ignoreBtn = document.createElement('button');
		ignoreBtn.textContent = '🚫 Ignore this PII';
		ignoreBtn.style.cssText = `
			width: 100%;
			padding: 6px 10px;
			margin-bottom: 8px;
			border: 1px solid #ff6b6b;
			background: #fff5f5;
			border-radius: 4px;
			cursor: pointer;
			font-size: 12px;
			color: #c53030;
		`;
		ignoreBtn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			onIgnore();
		});
		menu.appendChild(ignoreBtn);
	}

	// Selection choice section (only show if we have different selections)
	let selectedUseOriginal = false; // Default to tokenized selection
	const hasSelectionChoice = originalSelection && (
		originalSelection.word !== wordInfo.word || 
		originalSelection.from !== wordInfo.from || 
		originalSelection.to !== wordInfo.to
	);

	if (hasSelectionChoice && showTextField) {
		const selectionSection = document.createElement('div');
		selectionSection.style.cssText = `
			margin-bottom: 8px;
			padding: 8px;
			background: #f8f9fa;
			border-radius: 4px;
			border: 1px solid #e9ecef;
		`;

		const selectionTitle = document.createElement('div');
		selectionTitle.textContent = 'Selection:';
		selectionTitle.style.cssText = `
			font-weight: 600;
			font-size: 11px;
			color: #666;
			margin-bottom: 6px;
		`;
		selectionSection.appendChild(selectionTitle);

		// Smart selection radio option
		const smartOption = document.createElement('label');
		smartOption.style.cssText = `
			display: flex;
			align-items: flex-start;
			gap: 6px;
			cursor: pointer;
			margin-bottom: 4px;
			font-size: 11px;
		`;
		
		const smartRadio = document.createElement('input');
		smartRadio.type = 'radio';
		smartRadio.name = 'selectionChoice';
		smartRadio.value = 'smart';
		smartRadio.checked = true;
		smartRadio.style.cssText = `margin-top: 1px; flex-shrink: 0;`;
		
		const smartLabel = document.createElement('div');
		const smartDisplayText = wordInfo.word.length > 40 ? wordInfo.word.substring(0, 40) + '...' : wordInfo.word;
		smartLabel.innerHTML = `<strong>Smart:</strong> "${smartDisplayText}"`;
		smartLabel.style.cssText = `color: #333;`;
		
		smartOption.appendChild(smartRadio);
		smartOption.appendChild(smartLabel);
		selectionSection.appendChild(smartOption);

		// Original selection radio option
		const originalOption = document.createElement('label');
		originalOption.style.cssText = `
			display: flex;
			align-items: flex-start;
			gap: 6px;
			cursor: pointer;
			font-size: 11px;
		`;
		
		const originalRadio = document.createElement('input');
		originalRadio.type = 'radio';
		originalRadio.name = 'selectionChoice';
		originalRadio.value = 'original';
		originalRadio.style.cssText = `margin-top: 1px; flex-shrink: 0;`;
		
		const originalLabel = document.createElement('div');
		const originalDisplayText = originalSelection.word.length > 40 ? originalSelection.word.substring(0, 40) + '...' : originalSelection.word;
		originalLabel.innerHTML = `<strong>Exact:</strong> "${originalDisplayText}"`;
		originalLabel.style.cssText = `color: #333;`;
		
		originalOption.appendChild(originalRadio);
		originalOption.appendChild(originalLabel);
		selectionSection.appendChild(originalOption);

		// Radio button change handlers
		smartRadio.addEventListener('change', (e) => {
			e.stopPropagation();
			if (smartRadio.checked) {
				selectedUseOriginal = false;
			}
		});

		originalRadio.addEventListener('change', (e) => {
			e.stopPropagation();
			if (originalRadio.checked) {
				selectedUseOriginal = true;
			}
		});

		menu.appendChild(selectionSection);
	}

	// Label input section (only show if showTextField is true)
	if (showTextField) {
		const typeSection = document.createElement('div');
		typeSection.style.cssText = `
			display: flex;
			flex-direction: column;
			gap: 6px;
			position: relative;
		`;

		const typeInput = document.createElement('input');
		typeInput.type = 'text';
		typeInput.value = 'CUSTOM';
		typeInput.style.cssText = `
		width: 100%;
		padding: 6px 8px;
		border: 1px solid #ddd;
		border-radius: 4px;
		font-size: 12px;
		box-sizing: border-box;
		color: #999;
	`;

	let isDefaultValue = true;
	let skipAutocompletion = false;

	// Handle focus/click - clear default value
	const handleInputFocus = (e: Event) => {
		e.stopPropagation(); // Prevent click from bubbling up and closing menu
		console.log('PiiModifierExtension: Input field focused');
		
		// Notify timeout manager that input is focused
		if (timeoutManager) {
			(timeoutManager as any).setInputFocused(true);
		}
		
		if (isDefaultValue) {
			labelInput.value = '';
			labelInput.style.color = '#333';
			isDefaultValue = false;
		}
	};

	labelInput.addEventListener('focus', handleInputFocus);
	labelInput.addEventListener('click', handleInputFocus);

	// Handle blur - restore default if empty
	labelInput.addEventListener('blur', () => {
		
		// Notify timeout manager that input is no longer focused
		if (timeoutManager) {
			(timeoutManager as any).setInputFocused(false);
		}
		
		if (labelInput.value.trim() === '') {
			labelInput.value = 'CUSTOM';
			labelInput.style.color = '#999';
			isDefaultValue = true;
		}
	});

	// Handle input for inline autocompletion
	labelInput.addEventListener('input', (e) => {
		e.stopPropagation();
		
		// Skip autocompletion if we're handling a backspace
		if (skipAutocompletion) {
			skipAutocompletion = false;
			return;
		}
		
		const inputValue = labelInput.value;
		
		// Only autocomplete if not default value and user has typed something
		if (!isDefaultValue && inputValue) {
			const bestMatch = findBestMatch(inputValue, PREDEFINED_LABEL_TYPES);
			
			if (bestMatch && bestMatch !== inputValue.toUpperCase()) {
				// Complete the text inline
				const cursorPos = labelInput.selectionStart || 0;
				labelInput.value = bestMatch;
				
				// Select the completed portion
				labelInput.setSelectionRange(cursorPos, bestMatch.length);
			}
		}
	});

	// Prevent ProseMirror from intercepting keyboard events when input is focused
	labelInput.addEventListener('keydown', (e) => {
		// Stop propagation for all keyboard events to prevent ProseMirror interference
		e.stopPropagation();
		
		// Handle specific keys
		if (e.key === 'Enter') {
			e.preventDefault();
			const label = isDefaultValue ? 'CUSTOM' : labelInput.value.trim().toUpperCase();
			if (label) {
				onMask(label, selectedUseOriginal);
			}
		} else if (e.key === 'Tab') {
			// Accept the current autocompletion on Tab
			e.preventDefault();
			// The text is already completed, just move cursor to end
			labelInput.setSelectionRange(labelInput.value.length, labelInput.value.length);
		} else if (e.key === 'Escape') {
			// Close menu on Escape
			e.preventDefault();
			menu.remove();
		} else if (e.key === 'Backspace') {
			// Just set flag to skip autocompletion and let browser handle backspace naturally
			skipAutocompletion = true;
			// Don't prevent default - let browser handle backspace naturally
		}
		// For all other keys, let the input handle them naturally
	});

	// Also prevent keyup events from bubbling to ProseMirror
	labelInput.addEventListener('keyup', (e) => {
		e.stopPropagation();
	});



	const maskBtn = document.createElement('button');
	maskBtn.textContent = 'Mark as PII';
	maskBtn.style.cssText = `
		width: 100%;
		padding: 6px 10px;
		border: 1px solid #6b46c1;
		background: #6b46c1;
		border-radius: 4px;
		cursor: pointer;
		font-size: 12px;
		color: white;
		font-weight: 500;
		transition: background-color 0.2s ease;
	`;

	// Add hover effects for the button
	maskBtn.addEventListener('mouseenter', () => {
		maskBtn.style.backgroundColor = '#553c9a';
	});
	
	maskBtn.addEventListener('mouseleave', () => {
		maskBtn.style.backgroundColor = '#6b46c1';
	});

	// Handle mask button click
	maskBtn.addEventListener('click', (e) => {
		e.preventDefault();
		e.stopPropagation();
		const label = isDefaultValue ? 'CUSTOM' : labelInput.value.trim().toUpperCase();
		if (label) {
			onMask(label, selectedUseOriginal);
		} else {
			// Highlight input if empty
			labelInput.style.borderColor = '#ff6b6b';
			labelInput.focus();
			setTimeout(() => {
				labelInput.style.borderColor = '#ddd';
			}, 1000);
		}
	});



		labelSection.appendChild(labelInput);
		labelSection.appendChild(maskBtn);
		menu.appendChild(labelSection);
	}

	// Don't auto-focus to allow users to see the "CUSTOM" placeholder first
	// Users can click to focus when ready

	// Add hover protection to keep menu open
	menu.addEventListener('mouseenter', () => {
		// Cancel any pending hide timeout when hovering over menu
		console.log('PiiModifierExtension: Mouse entered menu, keeping it open');
		if (timeoutManager) {
			timeoutManager.clearAll();
		}
	});

	menu.addEventListener('mouseleave', (e) => {
		// Only hide menu if not moving to a child element (like the dropdown)
		const relatedTarget = e.relatedTarget as HTMLElement;
		if (relatedTarget && menu.contains(relatedTarget)) {
			return; // Don't hide if moving to a child element
		}
		
		// Hide menu when mouse leaves it with a longer delay
		if (timeoutManager) {
			timeoutManager.setFallback(() => {
				// Double-check the menu still exists and isn't being interacted with
				if (menu && document.body.contains(menu)) {
					const activeElement = document.activeElement;
					const isInputFocused = activeElement && menu.contains(activeElement);
					
					if (!isInputFocused) {
						menu.remove();
					}
				}
			}, 500);
		}
	});

	return menu;
}

export const PiiModifierExtension = Extension.create<PiiModifierOptions>({
	name: 'piiModifier',

	addOptions() {
		return {
			enabled: false,
			onModifiersChanged: undefined,
			availableTypes: PREDEFINED_LABEL_TYPES
		};
	},

	onCreate() {
		console.log('PiiModifierExtension: Extension created successfully');
	},

	addProseMirrorPlugins() {
		const options = this.options;
		const { enabled, onModifiersChanged, availableTypes } = options;

		console.log('PiiModifierExtension: Adding ProseMirror plugins', {
			enabled,
			hasCallback: !!onModifiersChanged,
			labelsCount: availableTypes?.length || 0
		});

		if (!enabled) {
			console.log('PiiModifierExtension: Disabled - not adding plugins');
			return [];
		}

		let hoverMenuElement: HTMLElement | null = null;
		let hoverTimeout: number | null = null;
		let menuCloseTimeout: ReturnType<typeof setTimeout> | null = null;
		let isMouseOverMenu = false;
		let isInputFocused = false;

		const plugin = new Plugin<PiiModifierState>({
			key: piiModifierExtensionKey,

			state: {
				init(): PiiModifierState {
					console.log('PiiModifierExtension: Initializing extension state');
					return {
						modifiers: [],
						hoveredWordInfo: null
					};
				},

				apply(tr, prevState): PiiModifierState {
					let newState = { ...prevState };

					// Handle document changes - update positions
					if (tr.docChanged) {
						const updatedModifiers = prevState.modifiers.map(modifier => ({
							...modifier,
							from: tr.mapping.map(modifier.from),
							to: tr.mapping.map(modifier.to)
						})).filter(modifier => 
							// Remove modifiers that are no longer valid
							modifier.from < modifier.to && 
							modifier.from >= 0 && 
							modifier.to <= tr.doc.content.size
						);

						newState = {
							...newState,
							modifiers: updatedModifiers
						};

						// Notify of changes if modifiers were removed
						if (updatedModifiers.length !== prevState.modifiers.length && onModifiersChanged) {
							onModifiersChanged(updatedModifiers);
						}
					}

					// Handle plugin-specific meta actions
					const meta = tr.getMeta(piiModifierExtensionKey);
					if (meta) {
						switch (meta.action) {
							case 'ADD_MODIFIER':
								const newModifier: PiiModifier = {
									id: generateModifierId(),
									action: meta.modifierAction,
									entity: meta.entity,
									type: meta.type,
									from: meta.from,
									to: meta.to
								};

								let updatedModifiers;
								
								if (meta.modifierAction === 'mask') {
									// For mask modifiers, replace any existing mask modifiers for the same entity
									updatedModifiers = newState.modifiers.filter(modifier => 
										!(modifier.action === 'mask' && modifier.entity.toLowerCase() === meta.entity.toLowerCase())
									);
									updatedModifiers.push(newModifier);
								} else {
									// For ignore modifiers, just add normally (ignore can coexist with masks)
									updatedModifiers = [...newState.modifiers, newModifier];
								}

								newState = {
									...newState,
									modifiers: updatedModifiers
								};

								if (onModifiersChanged) {
									onModifiersChanged(updatedModifiers);
								}

								// Trigger PII detection re-run in PiiDetectionExtension
								setTimeout(() => {
									// We need to access the view to dispatch the trigger
									// This will be available in the closure context
									if (meta.view) {
										const triggerTr = meta.view.state.tr.setMeta('piiDetection', {
											type: 'TRIGGER_DETECTION_WITH_MODIFIERS'
										});
										meta.view.dispatch(triggerTr);
									}
								}, 0);
								break;

							case 'REMOVE_MODIFIER':
								const filteredModifiers = newState.modifiers.filter(m => m.id !== meta.modifierId);
								newState = {
									...newState,
									modifiers: filteredModifiers
								};

								if (onModifiersChanged) {
									onModifiersChanged(filteredModifiers);
								}

								// Trigger PII detection re-run in PiiDetectionExtension
								setTimeout(() => {
									if (meta.view) {
										const triggerTr = meta.view.state.tr.setMeta('piiDetection', {
											type: 'TRIGGER_DETECTION_WITH_MODIFIERS'
										});
										meta.view.dispatch(triggerTr);
									}
								}, 0);
								break;
						}
					}

					return newState;
				}
			},

			props: {
				handleClick(view, pos, event) {
					// Hide menu immediately when clicking anywhere
					if (hoverMenuElement) {
						const target = event.target as HTMLElement;
						const isClickInsideMenu = hoverMenuElement.contains(target);
						
						if (!isClickInsideMenu) {
							hoverMenuElement.remove();
							hoverMenuElement = null;
							isInputFocused = false;
							// Clear all timeouts
							if (hoverTimeout) {
								clearTimeout(hoverTimeout);
								hoverTimeout = null;
							}
							if (menuCloseTimeout) {
								clearTimeout(menuCloseTimeout);
								menuCloseTimeout = null;
							}
						}
					}

					// Also check if selection was cleared by this click
					setTimeout(() => {
						const selection = view.state.selection;
						if (selection.from === selection.to && hoverMenuElement) {
							// Selection is empty and menu is still open - hide it
							hoverMenuElement.remove();
							hoverMenuElement = null;
							isInputFocused = false;
							// Clear all timeouts
							if (hoverTimeout) {
								clearTimeout(hoverTimeout);
								hoverTimeout = null;
							}
							if (menuCloseTimeout) {
								clearTimeout(menuCloseTimeout);
								menuCloseTimeout = null;
							}
						}
					}, 0);

					return false;
				},

				handleKeyDown(view, event) {
					// If input in menu is focused, don't let ProseMirror handle keyboard events
					if (isInputFocused) {
						return true; // This tells ProseMirror we handled the event
					}
					return false;
				},

				handleDOMEvents: {
					mousemove: (view, event) => {
						// Only handle hover for existing PII/modifier highlights - not for new text
						const target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement;
						const overExistingEntity = target && (
							target.closest('.pii-highlight') || 
							target.closest('.pii-modifier-highlight')
						);

						// If we're over an existing entity and no menu is currently shown
						if (overExistingEntity && !hoverMenuElement) {
							// Clear existing timeout
							if (hoverTimeout) {
								clearTimeout(hoverTimeout);
							}

							// Set new timeout for hover
							hoverTimeout = window.setTimeout(() => {
								const existingEntity = findExistingEntityAtPosition(view, event.clientX, event.clientY);
								if (!existingEntity) return;

								console.log('PiiModifierExtension: Hovering over existing entity:', existingEntity);

								// Find existing modifiers for this entity (check entity text match)
								const pluginState = piiModifierExtensionKey.getState(view.state);
								const existingModifiers = pluginState?.modifiers.filter(modifier => {
									// Check if modifier's entity text matches the current entity (case-insensitive)
									return modifier.entity.toLowerCase() === existingEntity.text.toLowerCase();
								}) || [];

								// Check if there are any mask modifiers for this entity
								const hasMaskModifier = existingModifiers.some(modifier => modifier.action === 'mask');
								// Check if there are any ignore modifiers for this entity
								const hasIgnoreModifier = existingModifiers.some(modifier => modifier.action === 'ignore');

								// For existing entities, always show ignore button if it's PII, and always show text field unless ignored
								const isPiiEntity = existingEntity.type === 'pii';

								// Create timeout manager
								const timeoutManager = {
									clearAll: () => {
										if (hoverTimeout) {
											clearTimeout(hoverTimeout);
											hoverTimeout = null;
										}
										if (menuCloseTimeout) {
											clearTimeout(menuCloseTimeout);
											menuCloseTimeout = null;
										}
									},
									setFallback: (callback: () => void, delay: number) => {
										if (menuCloseTimeout) {
											clearTimeout(menuCloseTimeout);
										}
										menuCloseTimeout = setTimeout(callback, delay);
									},
									setInputFocused: (focused: boolean) => {
										isInputFocused = focused;
									}
								};

								const onIgnore = () => {
									const tr = view.state.tr.setMeta(piiModifierExtensionKey, {
										type: 'ADD_MODIFIER',
										modifierAction: 'ignore' as ModifierAction,
										entity: existingEntity.text,
										from: existingEntity.from,
										to: existingEntity.to,
										view: view
									});
									view.dispatch(tr);

									if (hoverMenuElement) {
										hoverMenuElement.remove();
										hoverMenuElement = null;
									}
									timeoutManager.clearAll();
								};

								const onMask = (label: string, useOriginalSelection?: boolean) => {
									const tr = view.state.tr.setMeta(piiModifierExtensionKey, {
										type: 'ADD_MODIFIER',
										modifierAction: 'mask' as ModifierAction,
										entity: existingEntity.text,
										label,
										from: existingEntity.from,
										to: existingEntity.to,
										view: view
									});
									view.dispatch(tr);

									if (hoverMenuElement) {
										hoverMenuElement.remove();
										hoverMenuElement = null;
									}
									timeoutManager.clearAll();
								};

								const onRemoveModifier = (modifierId: string) => {
									const tr = view.state.tr.setMeta(piiModifierExtensionKey, {
										type: 'REMOVE_MODIFIER',
										modifierId,
										view: view
									});
									view.dispatch(tr);

									if (hoverMenuElement) {
										hoverMenuElement.remove();
										hoverMenuElement = null;
									}
									timeoutManager.clearAll();
								};

								hoverMenuElement = createHoverMenu(
									{
										word: existingEntity.text,
										from: existingEntity.from,
										to: existingEntity.to,
										x: event.clientX,
										y: event.clientY
									},
									onIgnore,
									onMask,
									isPiiEntity && !hasMaskModifier, // Show ignore button for PII entities without mask modifiers
									existingModifiers, // Pass existing modifiers
									onRemoveModifier, // Pass removal callback
									timeoutManager, // Pass timeout manager
									!hasIgnoreModifier, // Show text field unless entity is ignored
									undefined // No original selection for existing entities
								);

								document.body.appendChild(hoverMenuElement);

								// Set a fallback timeout to close menu after 10 seconds of inactivity
								timeoutManager.setFallback(() => {
									if (hoverMenuElement) {
										hoverMenuElement.remove();
										hoverMenuElement = null;
									}
								}, 10000);

							}, 300); // 300ms hover delay for existing entities
						} else if (!overExistingEntity && hoverTimeout) {
							// Clear hover timeout if not over existing entity
							clearTimeout(hoverTimeout);
							hoverTimeout = null;
						}
					},

					mouseup: (view, event) => {
						// Check if there's a text selection after mouseup
						setTimeout(() => {
							const selection = view.state.selection;
							
							if (selection.empty) {
								// No selection - already handled by apply method 
								return;
							}

							// Get the original user selection first
							const originalSelection = {
								from: selection.from,
								to: selection.to,
								text: getSelectionText(view.state.doc, selection.from, selection.to).trim()
							};

							// Use tokenizer to expand selection to whole word boundaries
							const tokenizedSelection = tokenizeSelection(view.state.doc, selection.from, selection.to);
							
							// Validate tokenized selection
							if (tokenizedSelection.text.length < 2 || tokenizedSelection.text.length > 100) {
								console.log('PiiModifierExtension: Tokenized selection invalid length:', tokenizedSelection.text.length);
								return;
							}
							
							// Check if we have valid tokens (more lenient for debugging)
							if (tokenizedSelection.tokens.length === 0) {
								console.log('PiiModifierExtension: No valid tokens found in selection');
								// For debugging, let's still show what we got
								console.log('PiiModifierExtension: Debug - tokenized result:', tokenizedSelection);
								return;
							}
							
							// Validate the original selection too
							if (originalSelection.text.length < 2 || originalSelection.text.length > 100) {
								console.log('PiiModifierExtension: Original selection invalid length:', originalSelection.text.length);
								return;
							}
							
							const validation = validateSelection(view, tokenizedSelection.from, tokenizedSelection.to);
							if (!validation.valid) {
								console.log('PiiModifierExtension: Tokenized selection conflicts with existing modifiers/PII');
								return;
							}

							// Use tokenized selection as the primary option
							const entityInfo = {
								from: tokenizedSelection.from,
								to: tokenizedSelection.to,
								text: tokenizedSelection.text
							};
							
							console.log('PiiModifierExtension: Valid selection detected:', {
								original: originalSelection,
								tokenized: entityInfo
							});

							// Check if text is currently highlighted as PII (by PII detection)
							const isPiiHighlighted = document.querySelector(`[data-pii-text="${entityInfo.text}"]`) !== null;

							// Find existing modifiers for this entity
							const pluginState = piiModifierExtensionKey.getState(view.state);
							const existingModifiers = pluginState?.modifiers.filter(modifier => {
								return modifier.entity.toLowerCase() === entityInfo.text.toLowerCase();
							}) || [];



							const hasMaskModifier = existingModifiers.some(modifier => modifier.action === 'mask');
							const hasIgnoreModifier = existingModifiers.some(modifier => modifier.action === 'ignore');

							// Hide existing menu first
							if (hoverMenuElement) {
								hoverMenuElement.remove();
								hoverMenuElement = null;
							}

							// Get position for menu placement
							const selectionCoords = view.coordsAtPos(selection.from);
							const menuX = selectionCoords.left;
							const menuY = selectionCoords.top - 80;

							// Create timeout manager
							const timeoutManager = {
								clearAll: () => {
									if (hoverTimeout) {
										clearTimeout(hoverTimeout);
										hoverTimeout = null;
									}
									if (menuCloseTimeout) {
										clearTimeout(menuCloseTimeout);
										menuCloseTimeout = null;
									}
								},
								setFallback: (callback: () => void, delay: number) => {
									if (menuCloseTimeout) {
										clearTimeout(menuCloseTimeout);
									}
									menuCloseTimeout = setTimeout(callback, delay);
								},
								setInputFocused: (focused: boolean) => {
									isInputFocused = focused;
								}
							};

							const onIgnore = () => {
								// For ignore operations, we'll use the tokenized selection by default
								// since ignore is primarily used for already-detected PII
								const tr = view.state.tr.setMeta(piiModifierExtensionKey, {
									type: 'ADD_MODIFIER',
									modifierAction: 'ignore' as ModifierAction,
									entity: entityInfo.text,
									from: entityInfo.from,
									to: entityInfo.to,
									view: view
								});
								view.dispatch(tr);

								if (hoverMenuElement) {
									hoverMenuElement.remove();
									hoverMenuElement = null;
								}
								timeoutManager.clearAll();
							};

							const onMask = (label: string, useOriginalSelection?: boolean) => {
								// Choose which selection to use based on radio button
								const selectedEntity = useOriginalSelection ? originalSelection : entityInfo;
								
								const tr = view.state.tr.setMeta(piiModifierExtensionKey, {
									type: 'ADD_MODIFIER',
									modifierAction: 'mask' as ModifierAction,
									entity: selectedEntity.text,
									label,
									from: selectedEntity.from,
									to: selectedEntity.to,
									view: view
								});
								view.dispatch(tr);

								if (hoverMenuElement) {
									hoverMenuElement.remove();
									hoverMenuElement = null;
								}
								timeoutManager.clearAll();
							};

							const onRemoveModifier = (modifierId: string) => {
								const tr = view.state.tr.setMeta(piiModifierExtensionKey, {
									type: 'REMOVE_MODIFIER',
									modifierId,
									view: view
								});
								view.dispatch(tr);

								if (hoverMenuElement) {
									hoverMenuElement.remove();
									hoverMenuElement = null;
								}
								timeoutManager.clearAll();
							};

							hoverMenuElement = createHoverMenu(
								{
									word: entityInfo.text,
									from: entityInfo.from,
									to: entityInfo.to,
									x: menuX,
									y: menuY
								},
								onIgnore,
								onMask,
								isPiiHighlighted && !hasMaskModifier,
								existingModifiers,
								onRemoveModifier,
								timeoutManager,
								!hasIgnoreModifier,
								{ word: originalSelection.text, from: originalSelection.from, to: originalSelection.to } // Pass original selection for radio button choice
							);

							document.body.appendChild(hoverMenuElement);

							// Set a fallback timeout to close menu after 10 seconds
							timeoutManager.setFallback(() => {
								if (hoverMenuElement) {
									hoverMenuElement.remove();
									hoverMenuElement = null;
								}
							}, 10000);

						}, 0); // Small delay to ensure selection is finalized
					}
				}
			},

			view(editorView) {
				// Track selection changes to hide menu when selection is cleared
				let lastSelection = editorView.state.selection;
				
				const checkSelectionChange = () => {
					const currentSelection = editorView.state.selection;
					
					// If selection changed from non-empty to empty, hide menu immediately
					if (!lastSelection.empty && currentSelection.empty && hoverMenuElement) {
						console.log('PiiModifierExtension: Selection cleared, hiding menu');
						hoverMenuElement.remove();
						hoverMenuElement = null;
						isInputFocused = false;
						
						// Clear any pending timeouts
						if (hoverTimeout) {
							clearTimeout(hoverTimeout);
							hoverTimeout = null;
						}
						if (menuCloseTimeout) {
							clearTimeout(menuCloseTimeout);
							menuCloseTimeout = null;
						}
					}
					
					lastSelection = currentSelection;
				};

				// Set up a mutation observer to watch for selection changes
				const observer = new MutationObserver(() => {
					// Use requestAnimationFrame to ensure we check after DOM updates
					requestAnimationFrame(checkSelectionChange);
				});

				// Start observing the editor for changes
				observer.observe(editorView.dom, {
					childList: true,
					subtree: true,
					attributes: true,
					attributeFilter: ['class']
				});

				// Also listen for selection change events
				const selectionChangeHandler = () => {
					requestAnimationFrame(checkSelectionChange);
				};

				document.addEventListener('selectionchange', selectionChangeHandler);

				return {
					update: (view, prevState) => {
						// Check selection on every update
						checkSelectionChange();
					},
					destroy: () => {
						// Clean up when plugin is destroyed
						observer.disconnect();
						document.removeEventListener('selectionchange', selectionChangeHandler);
						
						if (hoverMenuElement) {
							hoverMenuElement.remove();
							hoverMenuElement = null;
						}
						if (hoverTimeout) {
							clearTimeout(hoverTimeout);
							hoverTimeout = null;
						}
						if (menuCloseTimeout) {
							clearTimeout(menuCloseTimeout);
							menuCloseTimeout = null;
						}
					}
				};
			}
		});

		return [plugin];
	},

	addCommands() {
		return {
			// Get current modifiers
			getModifiers: () => ({ state }: any) => {
				const pluginState = piiModifierExtensionKey.getState(state);
				return pluginState?.modifiers || [];
			},

			// Clear all modifiers
			clearModifiers: () => ({ state, dispatch }: any) => {
				const pluginState = piiModifierExtensionKey.getState(state);
				if (!pluginState?.modifiers.length) {
					return false;
				}

				// Clear all modifiers
				const tr = state.tr.setMeta(piiModifierExtensionKey, {
					type: 'CLEAR_MODIFIERS'
				});

				if (dispatch) {
					dispatch(tr);
				}

				return true;
			},

			// Export modifiers in Shield API format
			exportModifiersForApi: () => ({ state }: any) => {
				const pluginState = piiModifierExtensionKey.getState(state);
				if (!pluginState?.modifiers.length) {
					return [];
				}

				return pluginState.modifiers.map(modifier => ({
					action: modifier.action,
					entity: modifier.entity,
					...(modifier.type && { type: modifier.type })
				}));
			}
		} as any;
	}
});

// Utility function to add CSS styles for the hover menu only
export function addPiiModifierStyles() {
	const styleId = 'pii-modifier-styles';
	
	// Check if styles already exist
	if (document.getElementById(styleId)) {
		return;
	}

	const styleElement = document.createElement('style');
	styleElement.id = styleId;
	styleElement.textContent = `
		.pii-modifier-hover-menu {
			animation: fadeIn 0.2s ease-in-out;
			pointer-events: auto;
		}

		@keyframes fadeIn {
			from { opacity: 0; transform: translateY(5px); }
			to { opacity: 1; transform: translateY(0); }
		}

		.pii-modifier-hover-menu button:hover {
			transform: scale(1.02);
			transition: transform 0.1s ease;
			box-shadow: 0 2px 8px rgba(0,0,0,0.1);
		}

		.pii-modifier-hover-menu input:focus {
			outline: none;
			border-color: #4ecdc4;
			box-shadow: 0 0 0 2px rgba(78, 205, 196, 0.2);
		}

		/* Radio button styles */
		.pii-modifier-hover-menu input[type="radio"] {
			accent-color: #6b46c1;
		}

		.pii-modifier-hover-menu label:hover {
			background-color: rgba(255, 255, 255, 0.5);
			border-radius: 2px;
			transition: background-color 0.1s ease;
		}

		/* Selection preview styles */
		.pii-modifier-hover-menu strong {
			color: #6b46c1;
		}

		/* Modifier highlighting styles */
		.pii-modifier-highlight {
			border-radius: 3px;
			padding: 1px 2px;
			font-weight: 500;
			cursor: pointer;
			transition: all 0.2s ease;
		}

		/* PII ignored by modifier: no background, orange font */
		.pii-modifier-highlight.pii-modifier-ignore {
			background-color: transparent;
			color: #ea580c; /* Orange font */
			border-bottom: 1px solid #ea580c;
		}

		.pii-modifier-highlight.pii-modifier-ignore:hover {
			background-color: rgba(234, 88, 12, 0.1); /* Light orange background on hover */
			color: #c2410c; /* Darker orange on hover */
		}

		/* PII set by modifier: green background, orange font */
		.pii-modifier-highlight.pii-modifier-mask {
			background-color: rgba(34, 197, 94, 0.15); /* Green background */
			color: #ea580c; /* Orange font */
			border-bottom: 1px solid rgba(34, 197, 94, 0.4);
		}

		.pii-modifier-highlight.pii-modifier-mask:hover {
			background-color: rgba(34, 197, 94, 0.25); /* Darker green on hover */
			color: #c2410c; /* Darker orange on hover */
		}
	`;

	document.head.appendChild(styleElement);
}