import type { PiiEntity } from '$lib/apis/pii';
import i18next from 'i18next';

// Extended PII entity with masking state
export interface ExtendedPiiEntity extends PiiEntity {
	shouldMask?: boolean;
}

// Debounce function for PII detection
export function debounce<T extends (...args: any[]) => any>(
	func: T,
	wait: number
): (...args: Parameters<T>) => void {
	let timeout: NodeJS.Timeout;
	return (...args: Parameters<T>) => {
		clearTimeout(timeout);
		timeout = setTimeout(() => func(...args), wait);
	};
}

// Convert PII entities to match text positions in the editor
export function adjustPiiEntitiesForEditor(
	entities: PiiEntity[],
	originalText: string,
	editorText: string
): PiiEntity[] {
	// If texts are identical, return as-is
	if (originalText === editorText) {
		return entities;
	}

	// For now, return entities as-is since we're working with plain text
	// In the future, this could handle markdown conversion differences
	return entities;
}

// Extract plain text from editor content for PII detection
export function extractPlainTextFromEditor(editorContent: string): string {
	// Remove HTML tags and convert to plain text
	const tempDiv = document.createElement('div');
	tempDiv.innerHTML = editorContent;
	return tempDiv.textContent || tempDiv.innerText || '';
}

// Count br tags before a given plain text position
export function countBrTagsBeforePosition(html: string, plainTextPos: number): number {
	// Extract plain text to find character positions
	const tempDiv = document.createElement('div');
	tempDiv.innerHTML = html;
	const plainText = tempDiv.textContent || tempDiv.innerText || '';
	
	if (plainTextPos >= plainText.length) {
		// Count all br tags if position is at or beyond end
		return (html.match(/<br\s*\/?>/gi) || []).length;
	}
	
	// Walk through the HTML and count br tags that appear before the target plain text position
	let currentPlainTextPos = 0;
	let brCount = 0;
	let htmlPos = 0;
	
	while (htmlPos < html.length && currentPlainTextPos < plainTextPos) {
		// Check if we're at a br tag
		const brMatch = html.slice(htmlPos).match(/^<br\s*\/?>/i);
		if (brMatch) {
			brCount++;
			htmlPos += brMatch[0].length;
			continue;
		}
		
		// Check if we're at the start of any tag
		const tagMatch = html.slice(htmlPos).match(/^<[^>]*>/);
		if (tagMatch) {
			htmlPos += tagMatch[0].length;
			continue;
		}
		
		// Regular character
		currentPlainTextPos++;
		htmlPos++;
	}
	
	return brCount;
}

// Simple position mapping that accounts for br tags
export function mapPlainTextPositionToProseMirror(
	plainTextPos: number,
	editorHtml: string
): number {
	// Count br tags that appear before this position in the plain text
	const brTagsBeforePosition = countBrTagsBeforePosition(editorHtml, plainTextPos);
	
	// ProseMirror positions start at 1, add 1 for document offset, plus br tag positions
	return plainTextPos + 1 + brTagsBeforePosition;
}

// Convert masked text back to editor format
export function convertMaskedTextToEditor(maskedText: string, originalHtml: string): string {
	// For now, return the masked text as-is
	// In the future, this could preserve formatting while masking content
	return maskedText;
}

// Get PII type color for highlighting
export function getPiiTypeColor(piiType: string): string {
	const colors: Record<string, string> = {
		PERSON: '#ff6b6b',
		EMAIL: '#4ecdc4',
		PHONE_NUMBER: '#45b7d1',
		PHONENUMBER: '#45b7d1',
		ADDRESS: '#96ceb4',
		SSN: '#feca57',
		CREDIT_CARD: '#ff9ff3',
		DATE_TIME: '#54a0ff',
		IP_ADDRESS: '#5f27cd',
		URL: '#00d2d3',
		IBAN: '#ff6348',
		MEDICAL_LICENSE: '#2ed573',
		US_PASSPORT: '#ffa502',
		US_DRIVER_LICENSE: '#3742fa',
		DEFAULT: '#ddd'
	};

	return colors[piiType.toUpperCase()] || colors.DEFAULT;
}

// Create CSS styles for PII highlighting
export function createPiiHighlightStyles(): string {
	return `
		.pii-highlight {
			border-radius: 3px;
			padding: 1px 2px;
			position: relative;
			cursor: pointer;
			transition: all 0.2s ease;
			border: 1px solid transparent;
		}
		
		.pii-highlight:hover {
			border: 1px solid #333;
			box-shadow: 0 1px 3px rgba(0,0,0,0.2);
		}
		
		/* Masked entities - green background */
		.pii-highlight.pii-masked {
			background-color: rgba(34, 197, 94, 0.2);
		}
		
		.pii-highlight.pii-masked:hover {
			background-color: rgba(34, 197, 94, 0.3);
		}
		
		/* Unmasked entities - red background */
		.pii-highlight.pii-unmasked {
			background-color: rgba(239, 68, 68, 0.2);
		}
		
		.pii-highlight.pii-unmasked:hover {
			background-color: rgba(239, 68, 68, 0.3);
		}
	`;
}

// Import PiiModifier type
import type { PiiModifier } from '$lib/components/common/RichTextInput/PiiModifierExtension';

// Conversation-specific PII state for storing with chat data
export interface ConversationPiiState {
	entities: ExtendedPiiEntity[];
	modifiers: PiiModifier[];
	sessionId?: string;
	apiKey?: string;
	lastUpdated: number;
}

// Store for PII session management
export class PiiSessionManager {
	private static instance: PiiSessionManager;
	private entities: ExtendedPiiEntity[] = [];
	private globalModifiers: PiiModifier[] = [];
	private sessionId: string | null = null;
	private apiKey: string = '';
	private conversationStates: Map<string, ConversationPiiState> = new Map();
	
	// Error recovery backup for failed saves
	private errorBackup: Map<string, ConversationPiiState> = new Map();
	private pendingSaves: Set<string> = new Set();
	// Track conversations currently being loaded
	private loadingConversations = new Set<string>();
	
	
	private temporaryState: {
		entities: ExtendedPiiEntity[];
		modifiers: PiiModifier[];
		isActive: boolean;
	} = {
		entities: [],
		modifiers: [],
		isActive: false
	};

	
	private workingEntitiesForConversations: Map<string, ExtendedPiiEntity[]> = new Map();

	static getInstance(): PiiSessionManager {
		if (!PiiSessionManager.instance) {
			PiiSessionManager.instance = new PiiSessionManager();
		}
		return PiiSessionManager.instance;
	}

	setApiKey(apiKey: string) {
		this.apiKey = apiKey;
	}

	
	activateTemporaryState() {
		this.temporaryState.isActive = true;
		this.temporaryState.entities = [];
		this.temporaryState.modifiers = [];
		
		// Clear global state to prevent contamination
		this.entities = [];
		this.globalModifiers = [];
	}

	
	isTemporaryStateActive(): boolean {
		return this.temporaryState.isActive;
	}

	
	setTemporaryStateEntities(entities: PiiEntity[]) {
		if (!this.temporaryState.isActive) {
			console.warn('PiiSessionManager: Attempted to set temporary state when not active');
			return;
		}
		
		// Convert to ExtendedPiiEntity - preserve shouldMask state for entities with same labels
		const existingEntities = this.temporaryState.entities;
		const newExtendedEntities = entities.map(entity => {
			// Check if this entity existed before and preserve its shouldMask state
			const existingEntity = existingEntities.find(e => e.label === entity.label);
			return {
				...entity,
				shouldMask: existingEntity ? existingEntity.shouldMask : true // Default to masked for new entities
			};
		});

		// Replace all entities with the latest detection results
		this.temporaryState.entities = newExtendedEntities;
	}

	
	getTemporaryEntities(): ExtendedPiiEntity[] {
		return [...this.temporaryState.entities];
	}

	
	transferTemporaryToConversation(conversationId: string) {
		if (!this.temporaryState.isActive) {
			return;
		}

		const finalEntities = this.getTemporaryEntities();
		
		// Create conversation state from final temporary entities
		const conversationState: ConversationPiiState = {
			entities: finalEntities, // Use final entities only
			modifiers: [...this.globalModifiers, ...this.temporaryState.modifiers],
			sessionId: this.sessionId || undefined,
			apiKey: this.apiKey || undefined,
			lastUpdated: Date.now()
		};

		this.conversationStates.set(conversationId, conversationState);

		// Deactivate temporary state
		this.temporaryState.isActive = false;
		this.temporaryState.entities = [];
		this.temporaryState.modifiers = [];

		// Trigger save for the new conversation
		this.triggerChatSave(conversationId);
	}

	
	clearTemporaryState() {
		this.temporaryState.isActive = false;
		this.temporaryState.entities = [];
		this.temporaryState.modifiers = [];
	}

	
	getEntitiesForDisplay(conversationId?: string): ExtendedPiiEntity[] {
		if (this.temporaryState.isActive) {
			// Return temporary entities for new chats
			return this.temporaryState.entities;
		} else if (conversationId) {
			// Return working entities if available (during typing), otherwise persistent entities
			return this.getConversationEntitiesForDisplay(conversationId);
		} else {
			// Fallback to global entities (backward compatibility)
			return this.entities;
		}
	}

	setSession(sessionId: string) {
		this.sessionId = sessionId;
	}

	getSession(): string | null {
		return this.sessionId;
	}

	// Set entities for the current global session (backwards compatibility)
	setEntities(entities: PiiEntity[]) {
		// Convert to extended entities with default masking enabled
		this.entities = entities.map((entity) => ({
			...entity,
			shouldMask: true // Default to masking enabled
		}));
	}

	// Get entities for the current global session (backwards compatibility)
	getEntities(): ExtendedPiiEntity[] {
		return this.entities;
	}

	// Main method for setting conversation state (entities + modifiers)
	setConversationState(
		conversationId: string, 
		entities: PiiEntity[], 
		modifiers: PiiModifier[] = [],
		sessionId?: string
	): void {
		const newExtendedEntities = entities.map((entity) => ({
			...entity,
			shouldMask: true
		}));

		// Get existing state to preserve shouldMask states
		const existingState = this.conversationStates.get(conversationId);
		const existingEntities = existingState?.entities || [];
		
		// Merge entities (preserve shouldMask)
		const mergedEntities = [...existingEntities];
		newExtendedEntities.forEach((newEntity) => {
			const existingIndex = mergedEntities.findIndex((e) => e.label === newEntity.label);
			if (existingIndex >= 0) {
				mergedEntities[existingIndex] = {
					...newEntity,
					shouldMask: mergedEntities[existingIndex].shouldMask
				};
			} else {
				mergedEntities.push(newEntity);
			}
		});

		const newState: ConversationPiiState = {
			entities: mergedEntities,
			modifiers: modifiers,
			sessionId: sessionId || existingState?.sessionId,
			apiKey: this.apiKey || existingState?.apiKey,
			lastUpdated: Date.now()
		};

		// Update memory state
		this.conversationStates.set(conversationId, newState);
		this.entities = mergedEntities;

		// Create backup for error recovery
		this.errorBackup.set(conversationId, { ...newState });

		// Trigger immediate SQLite save
		this.triggerChatSave(conversationId);
	}

	// Legacy method for backwards compatibility
	setConversationEntities(conversationId: string, entities: PiiEntity[], sessionId?: string) {
		const existingState = this.conversationStates.get(conversationId);
		this.setConversationState(conversationId, entities, existingState?.modifiers || [], sessionId);
	}

	// Trigger chat save method
	private async triggerChatSave(conversationId: string): Promise<void> {
		if (this.pendingSaves.has(conversationId)) {
			return; // Already saving
		}

		this.pendingSaves.add(conversationId);
		
		try {
			// Trigger the chat save handler 
			if ((window as any).triggerPiiChatSave) {
				await (window as any).triggerPiiChatSave(conversationId);
			}
			
			// Success - remove backup
			this.errorBackup.delete(conversationId);
		} catch (error) {
			console.error('PII chat save failed, keeping backup:', error);
			// Keep backup for retry
		} finally {
			this.pendingSaves.delete(conversationId);
		}
	}

	// Load from chat data (replaces localStorage loading)
	loadFromChatData(conversationId: string, piiState: ConversationPiiState): void {
		if (piiState) {
			this.conversationStates.set(conversationId, piiState);
			this.entities = piiState.entities;
		}
	}

	getConversationEntities(conversationId: string): ExtendedPiiEntity[] {
		const state = this.conversationStates.get(conversationId);
		return state?.entities || [];
	}

	getConversationState(conversationId: string): ConversationPiiState | null {
		return this.conversationStates.get(conversationId) || null;
	}

	// Load conversation state (now called from loadFromChatData)
	loadConversationState(conversationId: string, piiState?: ConversationPiiState) {
		// Prevent loading the same conversation multiple times simultaneously
		if (this.loadingConversations.has(conversationId)) {
			return;
		}
		
		// Check if conversation is already loaded
		if (this.conversationStates.has(conversationId) && !piiState) {
			return;
		}
		
		this.loadingConversations.add(conversationId);
		
		try {
			if (piiState) {
				this.conversationStates.set(conversationId, piiState);
				// Set as current global state
				this.entities = piiState.entities;
				this.sessionId = (piiState.sessionId as string) || null;
				this.apiKey = piiState.apiKey || this.apiKey;
			}
		} finally {
			this.loadingConversations.delete(conversationId);
		}
	}

	// Activate conversation - loads conversation-specific modifiers and entities into working state
	activateConversation(conversationId: string): boolean {
		// First ensure the conversation state is loaded
		this.loadConversationState(conversationId);
		
		const conversationState = this.conversationStates.get(conversationId);
		if (!conversationState) {
			return false;
		}
		
		// Load conversation's entities and modifiers into working state
		this.entities = [...conversationState.entities]; // Copy to avoid reference issues
		
		// Clear global modifiers and set conversation modifiers as active
		this.globalModifiers = []; // Clear global modifiers
		
		return true;
	}

	// Get active modifiers (for extensions to use)
	// This should be used by extensions instead of getGlobalModifiers/getConversationModifiers
	getActiveModifiers(conversationId?: string): PiiModifier[] {
		if (conversationId) {
			const conversationState = this.conversationStates.get(conversationId);
			if (conversationState) {
				return conversationState.modifiers;
			}
		}
		
		// Fallback to global modifiers
		return this.globalModifiers;
	}

	// Get state for saving to localStorage (chat data)
	getConversationStateForStorage(conversationId: string): ConversationPiiState | null {
		return this.conversationStates.get(conversationId) || null;
	}

	// Convert conversation entities to known entities format for API
	getKnownEntitiesForApi(
		conversationId: string
	): Array<{ id: number; label: string; name: string }> {
		const entities = this.getConversationEntities(conversationId);
		return entities.map((entity) => ({
			id: entity.id,
			label: entity.label,
			name: entity.raw_text
		}));
	}

	// Convert global entities to known entities format for API
	getGlobalKnownEntitiesForApi(): Array<{ id: number; label: string; name: string }> {
		const entities = this.getEntities();
		return entities.map((entity) => ({
			id: entity.id,
			label: entity.label,
			name: entity.raw_text
		}));
	}

	// MODIFIER MANAGEMENT METHODS

	// Get modifiers for conversation
	getConversationModifiers(conversationId: string): PiiModifier[] {
		const state = this.conversationStates.get(conversationId);
		return state?.modifiers || [];
	}

	// Get global modifiers (before conversation ID exists)
	getGlobalModifiers(): PiiModifier[] {
		return this.globalModifiers;
	}

	// Set conversation modifiers
	setConversationModifiers(conversationId: string, modifiers: PiiModifier[]) {
		const existingState = this.conversationStates.get(conversationId);
		const newState: ConversationPiiState = {
			entities: existingState?.entities || [],
			modifiers: modifiers,
			sessionId: existingState?.sessionId,
			apiKey: existingState?.apiKey || this.apiKey || undefined,
			lastUpdated: Date.now()
		};
		
		this.conversationStates.set(conversationId, newState);
		
		// Create backup and trigger save
		this.errorBackup.set(conversationId, { ...newState });
		this.triggerChatSave(conversationId);
	}

	// Set conversation entities while preserving existing modifiers
	setConversationEntitiesPreservingModifiers(conversationId: string, entities: PiiEntity[], sessionId?: string) {
		const existingState = this.conversationStates.get(conversationId);
		const existingModifiers = existingState?.modifiers || [];
		
		// Use the main setConversationState method which properly merges entities and preserves modifiers
		this.setConversationState(conversationId, entities, existingModifiers, sessionId);
	}

	// Set global modifiers (before conversation ID exists)
	setGlobalModifiers(modifiers: PiiModifier[]) {
		this.globalModifiers = modifiers;
	}

	// Clear global state when starting a completely new chat
	clearGlobalState() {
		this.entities = [];
		this.globalModifiers = [];
		this.sessionId = null;
	}

	// Switch to an existing conversation - load its state into working memory
	switchToConversation(conversationId: string) {
		const conversationState = this.conversationStates.get(conversationId);
		if (conversationState) {
			// Load conversation state into working memory
			this.entities = [...conversationState.entities];
			this.sessionId = conversationState.sessionId || null;
			// Clear global modifiers since we're using conversation-specific ones
			this.globalModifiers = [];
			return true;
		}
		return false;
	}

	// Transfer global state to conversation state when conversation ID becomes available
	transferGlobalToConversation(conversationId: string) {
		// Check if conversation already has state - don't overwrite SQLite data
		if (this.conversationStates.has(conversationId)) {
			// Load existing conversation state
			this.switchToConversation(conversationId);
			return; 
		}
		
		// Create initial conversation state with global data
		const newState: ConversationPiiState = {
			entities: [...this.entities], // Copy global entities
			modifiers: [...this.globalModifiers], // Copy global modifiers
			sessionId: this.sessionId || undefined,
			apiKey: this.apiKey || undefined,
			lastUpdated: Date.now()
		};
		
		this.conversationStates.set(conversationId, newState);

		// Clear global state since it's now managed as conversation state
		this.clearGlobalState();
		
		// Trigger save for the new conversation state
		this.triggerChatSave(conversationId);
	}

	// Ensure conversation state is loaded (synchronous)
	private ensureConversationLoaded(conversationId: string): boolean {
		if (this.conversationStates.has(conversationId)) {
			return true;
		}
		
		// Note: No localStorage loading - using SQLite only
		// State should be loaded via loadFromChatData() method
		return false;
	}

	// Get modifiers for API (works for both global and conversation state)
	getModifiersForApi(conversationId?: string): any[] {
		if (conversationId) {
			// Ensure conversation is loaded
			this.ensureConversationLoaded(conversationId);
			
			const conversationModifiers = this.getConversationModifiers(conversationId);
			return conversationModifiers.map(m => ({
				entity: m.entity,
				action: m.action,
				type: m.type || undefined
			}));
		} else {
			const globalModifiers = this.getGlobalModifiers();
			return globalModifiers.map(m => ({
				entity: m.entity,
				action: m.action,
				type: m.type || undefined
			}));
		}
	}

	// Add entities from API response that includes modifier-created entities
	appendConversationEntities(conversationId: string, newEntities: PiiEntity[], sessionId?: string) {
		const existingState = this.conversationStates.get(conversationId);
		const existingEntities = existingState?.entities || [];
		
		// Convert new entities to extended format
		const newExtendedEntities = newEntities.map((entity) => ({
			...entity,
			shouldMask: true // Default to masking enabled for new entities
		}));

		// Create a map of existing entities by label for quick lookup
		const existingEntityMap = new Map<string, ExtendedPiiEntity>();
		existingEntities.forEach(entity => {
			existingEntityMap.set(entity.label, entity);
		});

		// Merge new entities, preserving shouldMask state for existing ones
		const mergedEntities: ExtendedPiiEntity[] = [];
		
		// Add all existing entities first
		existingEntities.forEach(entity => {
			mergedEntities.push(entity);
		});

		// Add new entities, updating existing ones or adding truly new ones
		newExtendedEntities.forEach((newEntity) => {
			const existingEntity = existingEntityMap.get(newEntity.label);
			if (existingEntity) {
				// Update existing entity but preserve shouldMask state
				const existingIndex = mergedEntities.findIndex(e => e.label === newEntity.label);
				if (existingIndex >= 0) {
					mergedEntities[existingIndex] = {
						...newEntity,
						shouldMask: existingEntity.shouldMask // Preserve existing shouldMask state
					};
				}
			} else {
				// Add truly new entity
				mergedEntities.push(newEntity);
			}
		});

		// Update conversation state
		this.conversationStates.set(conversationId, {
			entities: mergedEntities,
			modifiers: existingState?.modifiers || [],
			sessionId: sessionId || existingState?.sessionId,
			apiKey: this.apiKey || existingState?.apiKey,
			lastUpdated: Date.now()
		});

		// Also update global state for current conversation
		this.entities = mergedEntities;
		if (sessionId) {
			this.sessionId = sessionId;
		}
	}

	// Append entities to global state (backwards compatibility)
	appendGlobalEntities(newEntities: PiiEntity[]) {
		const newExtendedEntities = newEntities.map((entity) => ({
			...entity,
			shouldMask: true
		}));

		// Create a map of existing entities by label for quick lookup
		const existingEntityMap = new Map<string, ExtendedPiiEntity>();
		this.entities.forEach(entity => {
			existingEntityMap.set(entity.label, entity);
		});

		// Merge entities, preserving shouldMask state for existing ones
		const mergedEntities: ExtendedPiiEntity[] = [...this.entities];
		
		newExtendedEntities.forEach((newEntity) => {
			const existingEntity = existingEntityMap.get(newEntity.label);
			if (existingEntity) {
				// Update existing entity but preserve shouldMask state
				const existingIndex = mergedEntities.findIndex(e => e.label === newEntity.label);
				if (existingIndex >= 0) {
					mergedEntities[existingIndex] = {
						...newEntity,
						shouldMask: existingEntity.shouldMask
					};
				}
			} else {
				// Add new entity
				mergedEntities.push(newEntity);
			}
		});

		this.entities = mergedEntities;
	}

	// Toggle entity masking for specific conversation
	toggleConversationEntityMasking(
		conversationId: string,
		entityId: string,
		occurrenceIndex: number
	) {
		const state = this.conversationStates.get(conversationId);
		if (state) {
			const entity = state.entities.find((e) => e.label === entityId);
			if (entity && entity.occurrences[occurrenceIndex]) {
				entity.shouldMask = !entity.shouldMask;
				state.lastUpdated = Date.now();

				// Update global state if this is the current conversation
				const globalEntity = this.entities.find((e) => e.label === entityId);
				if (globalEntity) {
					globalEntity.shouldMask = entity.shouldMask;
				}
				
				// Trigger SQLite save
				this.triggerChatSave(conversationId);
			}
		}
	}

	// Backwards compatibility
	toggleEntityMasking(entityId: string, occurrenceIndex: number) {
		const entity = this.entities.find((e) => e.label === entityId);
		if (entity && entity.occurrences[occurrenceIndex]) {
			entity.shouldMask = !entity.shouldMask;
		}
	}

	getEntityMaskingState(entityId: string): boolean {
		const entity = this.entities.find((e) => e.label === entityId);
		return entity?.shouldMask ?? true;
	}

	clearSession() {
		this.sessionId = null;
		this.entities = [];
	}

	// Clear conversation-specific state
	clearConversationState(conversationId: string) {
		this.conversationStates.delete(conversationId);
	}

	// Clear all conversation states
	clearAllConversationStates() {
		this.conversationStates.clear();
	}

	
	setConversationEntitiesFromLatestDetection(conversationId: string, entities: PiiEntity[], sessionId?: string) {
		// Get existing state to preserve shouldMask preferences for entities with same labels
		const existingState = this.conversationStates.get(conversationId);
		const existingEntities = existingState?.entities || [];
		
		// Convert new entities to extended format, preserving shouldMask state for entities with same labels
		const newExtendedEntities = entities.map(entity => {
			// Check if this entity exists in existing state and preserve its shouldMask state
			const existingEntity = existingEntities.find(e => e.label === entity.label);
			return {
				...entity,
				shouldMask: existingEntity ? existingEntity.shouldMask : true // Default to masked for new entities
			};
		});

		// Replace all entities with the latest detection results (like we do for temporary state)
		const newState: ConversationPiiState = {
			entities: newExtendedEntities, // Replace, don't merge
			modifiers: existingState?.modifiers || [],
			sessionId: sessionId || existingState?.sessionId,
			apiKey: this.apiKey || existingState?.apiKey,
			lastUpdated: Date.now()
		};

		// Update memory state
		this.conversationStates.set(conversationId, newState);
		
		// Update global working state for display (backward compatibility)
		this.entities = newExtendedEntities;

		// Create backup for error recovery
		this.errorBackup.set(conversationId, { ...newState });

		// Trigger immediate SQLite save
		this.triggerChatSave(conversationId);
	}

	
	setConversationWorkingEntities(conversationId: string, entities: PiiEntity[]) {
		// Get persistent entities to preserve shouldMask preferences from them
		const persistentEntities = this.getConversationEntities(conversationId);
		
		// Convert new entities to extended format, preserving shouldMask state for entities with same labels
		const newExtendedEntities = entities.map(entity => {
			// Check if this entity exists in persistent state and preserve its shouldMask state
			const persistentEntity = persistentEntities.find(e => e.label === entity.label);
			return {
				...entity,
				shouldMask: persistentEntity ? persistentEntity.shouldMask : true // Default to masked for new entities
			};
		});

		// Set working entities (for display) - doesn't affect persistent state
		this.workingEntitiesForConversations.set(conversationId, newExtendedEntities);
		
		// Also update global working state for display
		this.entities = newExtendedEntities;
	}

	
	getConversationEntitiesForDisplay(conversationId: string): ExtendedPiiEntity[] {
		// Return working entities if they exist (during typing), otherwise persistent entities
		return this.workingEntitiesForConversations.get(conversationId) || this.getConversationEntities(conversationId);
	}

	
	clearConversationWorkingEntities(conversationId: string) {
		this.workingEntitiesForConversations.delete(conversationId);
	}

	
	commitConversationWorkingEntities(conversationId: string) {
		const workingEntities = this.workingEntitiesForConversations.get(conversationId);
		if (workingEntities) {
			// Convert to PiiEntity format for the existing method
			const entities = workingEntities.map(entity => ({
				id: entity.id,
				label: entity.label,
				type: entity.type,
				raw_text: entity.raw_text,
				occurrences: entity.occurrences
			}));
			
			// Update persistent state
			this.setConversationEntitiesFromLatestDetection(conversationId, entities);
			
			// Clear working entities since they're now persistent
			this.clearConversationWorkingEntities(conversationId);
		}
	}
}

// Get label variations to handle different spellings
function getLabelVariations(label: string): string {
	const labelMap: Record<string, string[]> = {
		ORGANIZATION: ['ORGANIZATION', 'ORGANISATION', 'ORGANIZACION'],
		PERSON: ['PERSON', 'PERSONS', 'PERSONNE'],
		LOCATION: ['LOCATION', 'LIEU', 'LUGAR']
	};

	// Find the canonical form (first matching key or value in the map)
	const canonicalLabel =
		Object.entries(labelMap).find(([, variations]) =>
			variations.includes(label.toUpperCase())
		)?.[0] || label;

	return labelMap[canonicalLabel] ? `(?:${labelMap[canonicalLabel].join('|')})` : label;
}

// Function to detect masked patterns in text and unmask them
export function unmaskTextWithEntities(text: string, entities: ExtendedPiiEntity[]): string {
	if (!text || !entities?.length) return text;

	// Check if text is already highlighted (indicating it's been processed)
	if (text.includes('<span class="pii-highlight')) {
		return text;
	}

	// Replace each masked pattern with its original text
	let unmaskedText = text;
	entities.forEach((entity) => {
		const { label, raw_text: rawText } = entity;

		if (!label || !rawText) return;

		// Extract the base type and ID from the label (e.g., "PERSON_1" -> baseType="PERSON", labelId="1")
		const labelMatch = label.match(/^(.+)_(\d+)$/);
		if (!labelMatch) return;

		const [, baseType, labelId] = labelMatch;
		const labelVariations = getLabelVariations(baseType);

		// Create patterns for the exact label as it appears in masked text
		const labelRegex = new RegExp(
			`\\[\\{${labelVariations}_${labelId}\\}\\]|` + // [{TYPE_ID}]
				`\\[${labelVariations}_${labelId}\\]|` + // [TYPE_ID]
				`\\{${labelVariations}_${labelId}\\}|` + // {TYPE_ID}
				`\\b${labelVariations}_${labelId}\\b`, // TYPE_ID
			'g'
		);
		
		unmaskedText = unmaskedText.replace(labelRegex, rawText);
	});

	return unmaskedText;
}

// Function to highlight unmasked entities in response text
export function highlightUnmaskedEntities(text: string, entities: ExtendedPiiEntity[]): string {
	if (!entities.length || !text) return text;

	// Check if text is already highlighted to prevent double processing
	if (text.includes('<span class="pii-highlight')) {
		return text;
	}

	let highlightedText = text;

	// Sort entities by text length (longest first) to avoid partial replacements
	const sortedEntities = [...entities].sort((a, b) => b.raw_text.length - a.raw_text.length);

	sortedEntities.forEach((entity) => {
		// Skip entities with empty or invalid raw_text
		if (!entity.raw_text?.trim()) return;

		const escapedText = entity.raw_text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		
		// Use global flag but be more careful about word boundaries
		const hasSpecialChars = /[^\w\s]/.test(entity.raw_text);
		const regex = hasSpecialChars 
			? new RegExp(escapedText, 'gi')
			: new RegExp(`\\b${escapedText}\\b`, 'gi');

		highlightedText = highlightedText.replace(regex, (match) => {
			const shouldMask = entity.shouldMask ?? true;
			const maskingClass = shouldMask ? 'pii-masked' : 'pii-unmasked';
			const statusText = shouldMask ? 
				i18next.t('PII Modifier: Was masked in input') : 
				i18next.t('PII Modifier: Was NOT masked in input');

			return `<span class="pii-highlight ${maskingClass}" title="${entity.label} - ${statusText}" data-pii-type="${entity.type}" data-pii-label="${entity.label}">${match}</span>`;
		});
	});

	return highlightedText;
}

// Adjust PII entity positions when br tags are removed from text
export function adjustPiiEntityPositionsForDisplay(
	entities: ExtendedPiiEntity[],
	originalHtmlText: string
): ExtendedPiiEntity[] {
	if (!entities.length || !originalHtmlText) return entities;

	// Extract plain text without br tags for comparison
	const textWithoutBrTags = originalHtmlText.replace(/<br\s*\/?>/gi, '');
	
	// If no br tags were present, no adjustment needed
	if (originalHtmlText === textWithoutBrTags) {
		return entities;
	}

	return entities.map(entity => {
		const adjustedOccurrences = entity.occurrences.map(occurrence => {
			// Count br tags before this position in the original text
			const brTagsBeforeStart = countBrTagsBeforePosition(originalHtmlText, occurrence.start_idx);
			const brTagsBeforeEnd = countBrTagsBeforePosition(originalHtmlText, occurrence.end_idx);
			
			// Each br tag that was removed shifts positions back
			// Estimate br tag length as 4 characters (e.g., "<br>")
			const averageBrTagLength = 4;
			const startAdjustment = brTagsBeforeStart * averageBrTagLength;
			const endAdjustment = brTagsBeforeEnd * averageBrTagLength;
			
			const adjustedStart = Math.max(0, occurrence.start_idx - startAdjustment);
			const adjustedEnd = Math.max(adjustedStart, occurrence.end_idx - endAdjustment);

			return {
				...occurrence,
				start_idx: adjustedStart,
				end_idx: adjustedEnd
			};
		});

		return {
			...entity,
			occurrences: adjustedOccurrences
		};
	});
}

// Enhanced function to unmask and highlight text with modifier awareness for display
export function unmaskAndHighlightTextForDisplay(text: string, entities: ExtendedPiiEntity[], modifiers?: any[]): string {
	if (!entities.length || !text) return text;

	// Check if text is already processed to prevent double processing
	if (text.includes('<span class="pii-highlight')) {
		return text;
	}

	let processedText = text;
	let replacementsMade = 0;

	// Step 1: Unmask all patterns and simultaneously replace with highlighted spans
	entities.forEach((entity) => {
		const { label, raw_text: rawText } = entity;

		if (!label || !rawText) return;

		// Extract the base type and ID from the label
		const labelMatch = label.match(/^(.+)_(\d+)$/);
		if (!labelMatch) return;

		const [, baseType, labelId] = labelMatch;
		const labelVariations = getLabelVariations(baseType);

		// Create comprehensive patterns for masked text
		const patterns = [
			`\\[\\{${labelVariations}_${labelId}\\}\\]`,  // [{TYPE_ID}]
			`\\[${labelVariations}_${labelId}\\]`,        // [TYPE_ID]
			`\\{${labelVariations}_${labelId}\\}`,        // {TYPE_ID}
			`${labelVariations}_${labelId}(?=\\s|$|[^\\w])` // TYPE_ID as word boundary
		];
		
		// Use case-insensitive matching and global flag
		const labelRegex = new RegExp(patterns.join('|'), 'gi');

		// Replace masked patterns with highlighted spans containing the original text
		processedText = processedText.replace(labelRegex, (match) => {
			const shouldMask = entity.shouldMask ?? true;
			const maskingClass = shouldMask ? 'pii-masked' : 'pii-unmasked';
			const statusText = shouldMask ? 
				i18next.t('PII Modifier: Was masked in input') : 
				i18next.t('PII Modifier: Was NOT masked in input');

			replacementsMade++;
			return `<span class="pii-highlight ${maskingClass}" title="${entity.label} - ${statusText}" data-pii-type="${entity.type}" data-pii-label="${entity.label}">${rawText}</span>`;
		});
	});

	// Step 2: If no masked patterns were found, highlight any remaining raw text instances
	if (replacementsMade === 0) {
		// Sort entities by text length (longest first) to avoid partial replacements
		const sortedEntities = [...entities].sort((a, b) => b.raw_text.length - a.raw_text.length);

		sortedEntities.forEach((entity) => {
			// Skip entities with empty or invalid raw_text
			if (!entity.raw_text?.trim()) return;

			// Escape special regex characters and create pattern
			const escapedText = entity.raw_text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			
			// Use word boundaries for better matching, but handle special characters gracefully
			const hasSpecialChars = /[^\w\s]/.test(entity.raw_text);
			const regex = hasSpecialChars 
				? new RegExp(escapedText, 'gi')
				: new RegExp(`\\b${escapedText}\\b`, 'gi');

			processedText = processedText.replace(regex, (match) => {
				const shouldMask = entity.shouldMask ?? true;
				const maskingClass = shouldMask ? 'pii-masked' : 'pii-unmasked';
				const statusText = shouldMask ? 
					i18next.t('PII Modifier: Was masked in input') : 
					i18next.t('PII Modifier: Was NOT masked in input');

				replacementsMade++;
				return `<span class="pii-highlight ${maskingClass}" title="${entity.label} - ${statusText}" data-pii-type="${entity.type}" data-pii-label="${entity.label}">${match}</span>`;
			});
		});
	}

	return processedText;
}
