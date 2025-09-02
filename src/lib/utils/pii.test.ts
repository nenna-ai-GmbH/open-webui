import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PiiSessionManager, type ExtendedPiiEntity } from './pii';

describe('PII Session Manager', () => {
  let piiManager: PiiSessionManager;

  beforeEach(() => {
    // Reset singleton instance for each test
    vi.resetModules();
    piiManager = PiiSessionManager.getInstance();
  });

  describe('Entity Consolidation', () => {
    it('should consolidate entities from different sources', () => {
      const knownEntities = [
        { id: 1, label: 'PERSON_1', name: 'John Doe' },
        { id: 2, label: 'EMAIL_1', name: 'john@example.com' }
      ];

      const fileEntities = [
        { text: 'John Doe', type: 'PERSON', occurrences: [{ start_idx: 0, end_idx: 8 }] },
        { text: 'john@example.com', type: 'EMAIL', occurrences: [{ start_idx: 10, end_idx: 25 }] }
      ];

      // Simulate consolidation by matching names
      const consolidated = fileEntities.map(fileEntity => {
        const knownEntity = knownEntities.find(known => 
          known.name.toLowerCase() === fileEntity.text.toLowerCase()
        );
        return {
          ...fileEntity,
          id: knownEntity?.id
        };
      });

      expect(consolidated[0].id).toBe(1);
      expect(consolidated[1].id).toBe(2);
    });

    it('should handle case-insensitive matching', () => {
      const knownEntities = [
        { id: 1, label: 'PERSON_1', name: 'John Doe' }
      ];

      const fileEntities = [
        { text: 'JOHN DOE', type: 'PERSON', occurrences: [{ start_idx: 0, end_idx: 8 }] }
      ];

      const consolidated = fileEntities.map(fileEntity => {
        const knownEntity = knownEntities.find(known => 
          known.name.toLowerCase() === fileEntity.text.toLowerCase()
        );
        return {
          ...fileEntity,
          id: knownEntity?.id
        };
      });

      expect(consolidated[0].id).toBe(1);
    });

    it('should handle entities without matches', () => {
      const knownEntities = [
        { id: 1, label: 'PERSON_1', name: 'John Doe' }
      ];

      const fileEntities = [
        { text: 'Jane Smith', type: 'PERSON', occurrences: [{ start_idx: 0, end_idx: 10 }] }
      ];

      const consolidated = fileEntities.map(fileEntity => {
        const knownEntity = knownEntities.find(known => 
          known.name.toLowerCase() === fileEntity.text.toLowerCase()
        );
        return {
          ...fileEntity,
          id: knownEntity?.id
        };
      });

      expect(consolidated[0].id).toBeUndefined();
    });
  });

  describe('Session Management', () => {
    it('should manage conversation entities correctly', () => {
      const conversationId = 'test-conversation';
      const entities: ExtendedPiiEntity[] = [
        {
          id: 1,
          label: 'PERSON_1',
          type: 'PERSON',
          raw_text: 'John Doe',
          occurrences: [{ start_idx: 0, end_idx: 8 }],
          shouldMask: true
        }
      ];

      piiManager.setConversationEntitiesFromLatestDetection(conversationId, entities);
      const retrieved = piiManager.getEntitiesForDisplay(conversationId);

      expect(retrieved).toHaveLength(1);
      expect(retrieved[0].label).toBe('PERSON_1');
      expect(retrieved[0].shouldMask).toBe(true);
    });

    it('should merge entities with existing ones', () => {
      const conversationId = 'test-conversation';
      const initialEntities: ExtendedPiiEntity[] = [
        {
          id: 1,
          label: 'PERSON_1',
          type: 'PERSON',
          raw_text: 'John Doe',
          occurrences: [{ start_idx: 0, end_idx: 8 }],
          shouldMask: true
        }
      ];

      piiManager.setConversationEntitiesFromLatestDetection(conversationId, initialEntities);

      const newEntities: ExtendedPiiEntity[] = [
        {
          id: 2,
          label: 'EMAIL_1',
          type: 'EMAIL',
          raw_text: 'john@example.com',
          occurrences: [{ start_idx: 10, end_idx: 25 }],
          shouldMask: false
        }
      ];

      piiManager.setConversationEntitiesFromLatestDetection(conversationId, newEntities);
      const retrieved = piiManager.getEntitiesForDisplay(conversationId);

      expect(retrieved).toHaveLength(2);
      expect(retrieved.find(e => e.label === 'PERSON_1')?.shouldMask).toBe(true);
      expect(retrieved.find(e => e.label === 'EMAIL_1')?.shouldMask).toBe(false);
    });

    it('should convert entities to API format correctly', () => {
      const conversationId = 'test-conversation';
      const entities: ExtendedPiiEntity[] = [
        {
          id: 1,
          label: 'PERSON_1',
          type: 'PERSON',
          raw_text: 'John Doe',
          occurrences: [{ start_idx: 0, end_idx: 8 }],
          shouldMask: true
        }
      ];

      piiManager.setConversationEntitiesFromLatestDetection(conversationId, entities);
      const apiFormat = piiManager.getKnownEntitiesForApi(conversationId);

      expect(apiFormat).toHaveLength(1);
      expect(apiFormat[0]).toEqual({
        id: 1,
        label: 'PERSON_1',
        name: 'John Doe'
      });
    });
  });

  describe('Temporary State Management', () => {
    it('should handle temporary state for new chats', () => {
      piiManager.activateTemporaryState();
      
      const entities: ExtendedPiiEntity[] = [
        {
          id: 1,
          label: 'PERSON_1',
          type: 'PERSON',
          raw_text: 'John Doe',
          occurrences: [{ start_idx: 0, end_idx: 8 }],
          shouldMask: true
        }
      ];

      piiManager.setTemporaryStateEntities(entities);
      const retrieved = piiManager.getEntitiesForDisplay();

      expect(retrieved).toHaveLength(1);
      expect(retrieved[0].label).toBe('PERSON_1');
    });

    it('should transfer temporary state to conversation', () => {
      piiManager.activateTemporaryState();
      
      const entities: ExtendedPiiEntity[] = [
        {
          id: 1,
          label: 'PERSON_1',
          type: 'PERSON',
          raw_text: 'John Doe',
          occurrences: [{ start_idx: 0, end_idx: 8 }],
          shouldMask: true
        }
      ];

      piiManager.setTemporaryStateEntities(entities);
      
      const conversationId = 'new-conversation';
      piiManager.transferTemporaryToConversation(conversationId);
      
      const retrieved = piiManager.getEntitiesForDisplay(conversationId);
      expect(retrieved).toHaveLength(1);
      expect(retrieved[0].label).toBe('PERSON_1');
      
      // Temporary state should be cleared
      expect(piiManager.isTemporaryStateActive()).toBe(false);
    });
  });

  describe('Entity Masking Toggle', () => {
    it('should toggle entity masking state', () => {
      const conversationId = 'test-conversation';
      const entities: ExtendedPiiEntity[] = [
        {
          id: 1,
          label: 'PERSON_1',
          type: 'PERSON',
          raw_text: 'John Doe',
          occurrences: [{ start_idx: 0, end_idx: 8 }],
          shouldMask: true
        }
      ];

      piiManager.setConversationEntitiesFromLatestDetection(conversationId, entities);
      
      // Toggle masking
      piiManager.toggleEntityMasking('PERSON_1', 0, conversationId);
      
      const retrieved = piiManager.getEntitiesForDisplay(conversationId);
      expect(retrieved[0].shouldMask).toBe(false);
      
      // Toggle back
      piiManager.toggleEntityMasking('PERSON_1', 0, conversationId);
      const retrieved2 = piiManager.getEntitiesForDisplay(conversationId);
      expect(retrieved2[0].shouldMask).toBe(true);
    });
  });
});


