# PII Modifier System Architecture

## Core Concept
A ProseMirror-based system that allows users to manually control PII detection behavior through modifiers sent to the Nenna API, with persistent storage and visual feedback.

## API Integration

### Nenna API Modifiers
```typescript
interface ApiModifier {
  action: 'mask' | 'ignore';
  entity: string;           // The actual text
  type?: string;           // Required for 'mask', optional for 'ignore'
}

// Examples:
// {"action": "mask", "entity": "meep", "type": "CUSTOM"}
// {"action": "ignore", "entity": "Dr. Hahn"}
```

### API Request Pattern
```typescript
const response = await maskPiiText(
  apiKey, 
  [text], 
  knownEntities,    // ALL previously detected PIIs for consistent labeling
  modifiers,        // User-created modifiers for this request
  false, 
  false
);
```

## State Management Architecture

### Two-Tier Storage System
1. **Global State**: Used before conversation ID exists (first prompt)
2. **Conversation State**: Used after conversation ID is assigned

```typescript
interface ConversationPiiState {
  entities: KnownPiiEntity[];     // Append-only, never remove
  modifiers: PiiModifier[];       // Can be modified/removed
  sessionId?: string;
  lastUpdated: number;
}

class PiiSessionManager {
  // Global state (pre-conversation)
  private globalEntities: KnownPiiEntity[] = [];
  private globalModifiers: PiiModifier[] = [];
  
  // Conversation-specific states
  private conversationStates: Map<string, ConversationPiiState> = new Map();
  
  // Transfer global → conversation when ID becomes available
  transferGlobalToConversation(conversationId: string);
}
```

### Persistence Strategy
- **localStorage**: Both global and conversation states persist
- **Transfer Logic**: When conversationId changes from empty → actual ID, copy global state to conversation state
- **Append-Only Entities**: Known entities only grow, never shrink
- **Mutable Modifiers**: Can be added/removed/changed at any time

## User Interface Components

### ProseMirror Extension Integration
```typescript
// Two extensions work together:
PiiDetectionExtension    // Handles API calls and PII highlighting
PiiModifierExtension     // Handles user modifier creation/management
```

### Hover Menu System
**Triggers:**
- Hover over detected PII entity
- Text selection in editor

**Tokenizer Logic:**
- When text is selected, tokenize using regex: `[\w'-äöüÄÖÜß]`
- Suggests all words touched by selection
- Default: tokenized selection (individual words)
- Option: exact match selection
- Radio buttons for user choice

**Menu Actions:**
- **Ignore**: Add ignore modifier (only for originally detected PIIs)
- **Mask**: Add mask modifier (type required, defaults to "CUSTOM")
- **Type Input**: Typeahead with standard types + custom input allowed
- **Remove**: Remove existing modifier

**Behavior by Context:**
- **Hovering Detected PII**: Show ignore/mask/remove options
- **Hovering Modifier**: Show current modifier info + remove option
- **Selecting Non-PII Text**: Show only mask option (force detection)
- **Selecting Mixed Text**: Tokenize and offer individual word options

### Visual Styling System
```css
/* Detected PIIs */
.pii-masked { 
  background: green; 
  color: green; 
  border-bottom: 2px solid green; 
}

.pii-unmasked { 
  background: red; 
  color: white; 
  border-bottom: 2px dashed red; 
}

/* User Modifiers */
.pii-modifier { 
  color: orange; 
}

.pii-modifier-mask { 
  background: green; 
  color: orange; 
}

.pii-modifier-ignore { 
  /* no background */ 
  color: orange; 
}
```

## Business Rules

### Entity Management
- **Known Entities**: Append-only collection sent with every API call
- **Purpose**: Maintain consistent labeling (PERSON_1 always same person)
- **Growth**: Only add, never remove or modify
- **Source**: ALL detections (original API + user-created via modifiers)
- **Critical**: Every modifier-created entity becomes a known entity with unique label for unmasking

### Modifier Management
- **One Modifier Per Entity Text**: Each unique text string can have max one modifier
- **Originally Detected PIIs**: Can use 'ignore' (to suppress) or 'mask' (to change type)
- **Non-Detected Text**: Can only use 'mask' (to force detection)
- **Replacement Logic**: New modifier replaces old modifier for same entity text
- **Scope**: Modifiers can be added/changed in any prompt, not just first
- **Persistence**: Modifiers survive conversation reloads

### Conversation Flow
```
1. First Prompt (no conversationId):
   - Store entities/modifiers in global state
   - Send API request with global modifiers

2. Response Creates ConversationId:
   - Transfer global state → conversation state
   - Clear global state (no longer needed)

3. Subsequent Prompts:
   - Use conversation-specific state
   - Continue accumulating entities
   - Allow modifier changes
```

## Implementation Patterns

### API Call Pattern
```typescript
const performPiiDetection = async (text: string, conversationId?: string) => {
  // Get known entities (for consistent labeling)
  const knownEntities = conversationId 
    ? sessionManager.getConversationEntities(conversationId)
    : sessionManager.getGlobalEntities();
    
  // Get current modifiers (for behavior control)
  const modifiers = conversationId
    ? sessionManager.getConversationModifiers(conversationId)
    : sessionManager.getGlobalModifiers();
    
  const response = await maskPiiText(apiKey, [text], knownEntities, modifiers);
  
     // Store ALL returned entities (append-only)
   // This includes both original detections AND modifier-created entities
   if (conversationId) {
     sessionManager.appendConversationEntities(conversationId, response.pii[0]);
   } else {
     sessionManager.appendGlobalEntities(response.pii[0]);
   }
};
```

### Decoration Separation
```typescript
// Separate PII decorations from Modifier decorations
const createDecorations = (entities: PiiEntity[], modifiers: PiiModifier[]) => {
  const piiDecorations = entities
    .filter(entity => !hasModifier(entity, modifiers))
    .map(entity => createPiiDecoration(entity));
    
  const modifierDecorations = modifiers
    .map(modifier => findAndCreateModifierDecorations(modifier));
    
  return [...piiDecorations, ...modifierDecorations];
};
```

### Error Handling Principles
- **API Failures**: Graceful degradation, continue without PII features
- **Missing ConversationId**: Use global state until available
- **Storage Failures**: Log errors but don't block functionality
- **Position Mapping**: Validate ranges before creating decorations

## Critical Success Factors

1. **Consistent Labeling**: Known entities ensure PERSON_1 always refers to same person
2. **State Persistence**: Modifiers and entities survive page reloads
3. **Visual Feedback**: Clear distinction between PIIs, modifiers, and their states
4. **User Control**: Easy modifier creation/removal without technical knowledge
5. **Performance**: Debounced API calls, efficient decoration updates
6. **Separation of Concerns**: PII detection ≠ Modifier management (different visual treatments) 