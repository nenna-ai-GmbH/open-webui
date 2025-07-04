// Mock PiiDetectionExtension for demonstration purposes
// This is a simplified version that shows the detection state functionality

interface PiiDetectionOptions {
	enabled: boolean;
	apiKey: string;
	conversationId?: string;
	onPiiDetected?: (entities: any[], maskedText: string) => void;
	onPiiToggled?: (entities: any[]) => void;
	onDetectionStateChange?: (isDetecting: boolean) => void;
	debounceMs?: number;
}

// Mock extension that simulates PII detection with detection state tracking
export const PiiDetectionExtension = {
	configure(options: PiiDetectionOptions) {
		return {
			name: 'piiDetection',
			priority: 1000,
			
			onCreate() {
				// Mock detection logic that shows the spinner
				const simulateDetection = () => {
					if (options.onDetectionStateChange) {
						options.onDetectionStateChange(true);
					}
					
					// Simulate async detection process
					setTimeout(() => {
						if (options.onDetectionStateChange) {
							options.onDetectionStateChange(false);
						}
						
						// Mock detected entities
						if (options.onPiiDetected) {
							options.onPiiDetected([], '');
						}
					}, 1000 + Math.random() * 2000); // 1-3 seconds
				};
				
				// Simulate detection trigger on text changes
				let lastText = '';
				const checkForTextChanges = () => {
					// This is a simplified check - in a real implementation
					// this would be integrated with the editor's document changes
					// For now, we'll just trigger detection periodically as a demo
					const currentText = 'mock text'; // In real implementation, get from editor
					if (currentText !== lastText && currentText.trim().length > 0) {
						lastText = currentText;
						simulateDetection();
					}
				};
				
				// Check for changes every 500ms (in a real implementation, this would be event-driven)
				setInterval(checkForTextChanges, 500);
			}
		};
	}
};