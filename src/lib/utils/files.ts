import type { ExtendedPiiEntity } from '$lib/utils/pii';

/**
 * Extract stored PII entities from a file object
 * @param fileObj - File object that may contain PII entities in various locations
 * @returns Array of PII entities or empty array if none found
 */
export const extractStoredPiiEntities = (fileObj: any): ExtendedPiiEntity[] => {
	if (!fileObj) return [];

	// Check multiple possible locations where PII entities might be stored
	const possiblePaths = [
		fileObj.file?.data?.piiEntities,
		fileObj.data?.piiEntities,
		fileObj.piiEntities,
		fileObj.file?.piiEntities
	];

	for (const entities of possiblePaths) {
		if (Array.isArray(entities) && entities.length > 0) {
			console.log(`Found ${entities.length} stored PII entities in file`);
			return entities;
		}
	}

	return [];
};

/**
 * Get PII detection metadata from a file object
 * @param fileObj - File object that may contain PII detection metadata
 * @returns Object with detection metadata or null if not found
 */
export const getPiiDetectionMetadata = (fileObj: any): { 
	timestamp: number | null; 
	entityCount: number; 
	error?: string;
} => {
	const entities = extractStoredPiiEntities(fileObj);
	
	// Check for detection timestamp
	const possibleTimestampPaths = [
		fileObj.file?.data?.piiDetectionTimestamp,
		fileObj.data?.piiDetectionTimestamp,
		fileObj.piiDetectionTimestamp,
		fileObj.file?.piiDetectionTimestamp
	];

	let timestamp = null;
	for (const ts of possibleTimestampPaths) {
		if (typeof ts === 'number' && ts > 0) {
			timestamp = ts;
			break;
		}
	}

	return {
		timestamp,
		entityCount: entities.length,
		error: fileObj.file?.data?.error || fileObj.data?.error || fileObj.error
	};
};

/**
 * Check if a file has undergone PII detection
 * @param fileObj - File object to check
 * @returns Boolean indicating if PII detection was performed
 */
export const hasBeenScannedForPii = (fileObj: any): boolean => {
	const metadata = getPiiDetectionMetadata(fileObj);
	return metadata.timestamp !== null;
};

/**
 * Get a human-readable summary of PII detection results for a file
 * @param fileObj - File object to analyze
 * @returns Human-readable string describing PII status
 */
export const getPiiSummary = (fileObj: any): string => {
	const metadata = getPiiDetectionMetadata(fileObj);
	
	if (metadata.error) {
		return `PII detection failed: ${metadata.error}`;
	}
	
	if (!hasBeenScannedForPii(fileObj)) {
		return 'Not scanned for PII';
	}
	
	if (metadata.entityCount === 0) {
		return 'No PII detected';
	}
	
	if (metadata.entityCount === 1) {
		return '1 PII entity detected';
	}
	
	return `${metadata.entityCount} PII entities detected`;
}; 