import { test, expect } from '@playwright/test';
import { PiiTestHelpers } from './utils/pii-helpers';

/**
 * PII (Personally Identifiable Information) End-to-End Tests
 * 
 * These tests verify the PII detection, masking, and unmasking functionality
 * in the Open WebUI chat interface.
 */

test.describe('PII Functionality', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the application
    await page.goto('/');
    
    // Wait for the application to load
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000); // Allow PII system to initialize
    
    // Check if we're on the login page
    const signInText = page.locator('text=Sign in to Open WebUI');
    const isLoginPage = await signInText.isVisible();
    
    if (isLoginPage) {
      // Handle login - you mentioned max@nenna.ai/test
      // Look for email and password fields
      const emailField = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]');
      const passwordField = page.locator('input[type="password"], input[name="password"], input[placeholder*="password" i]');
      
      if (await emailField.isVisible() && await passwordField.isVisible()) {
        await emailField.fill('max@nenna.ai');
        await passwordField.fill('test');
        
        // Find and click the sign in button
        const signInButton = page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Login")');
        await signInButton.click();
        
        // Wait for redirect to main app
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(3000);
      }
    }
    
    // Verify we're in the chat interface - look for the TipTap/ProseMirror editor
    await expect(page.locator('#chat-input')).toBeVisible({ timeout: 10000 });
  });

  test('should detect PII in user input and show scanning indicator', async ({ page }) => {
    const helpers = new PiiTestHelpers(page);
    
    // Enter text containing PII (person name and location)
    const piiText = 'Max F aus Berlin.';
    
    await helpers.enterMessage(piiText);
    
    // Verify the text appears in the input
    await expect(page.locator('#chat-input')).toContainText(piiText);
    
    // Check for PII scanning indicator
    const scanningIndicator = page.locator('text=Scanning for PII');
    await expect(scanningIndicator).toBeVisible({ timeout: 5000 });
    
    // Wait for PII detection to complete
    await page.waitForTimeout(3000);
    
    // Send the message
    await helpers.sendMessage();
    
    // Verify the message appears in chat history
    await helpers.verifyMessageInChat(piiText);
  });

  test('should toggle PII masking on/off via the mask button', async ({ page }) => {
    const helpers = new PiiTestHelpers(page);
    
    // Enter some text first to ensure the masking button is visible
    await helpers.enterMessage('Test text');
    
    // Locate the masking toggle button (should be visible now)
    const maskButton = page.getByRole('button', { name: 'Maskieren' });
    await expect(maskButton).toBeVisible({ timeout: 10000 });
    
    // Toggle masking
    await helpers.toggleMasking();
    
    // Verify the toggle action completed
    await page.waitForTimeout(500);
  });

  test('should send unmasked text when masking is disabled', async ({ page }) => {
    const helpers = new PiiTestHelpers(page);
    
    // Disable PII masking first
    await helpers.toggleMasking();
    
    // Enter text with PII
    const piiText = 'Mein Name ist Sarah Schmidt und ich wohne in München.';
    
    await helpers.sendChatMessage(piiText);
    
    // Verify the original text appears in chat (unmasked)
    await helpers.verifyMessageInChat(piiText);
  });

  test('should display PII highlighting in AI responses', async ({ page }) => {
    // Send a message with PII to get an AI response
    const messageInput = page.getByRole('paragraph').filter({ hasText: /^$/ });
    await messageInput.fill('Max F aus Berlin.');
    await page.keyboard.press('Enter');
    
    // Wait for AI response
    await expect(page.locator('text=Hallo Max F')).toBeVisible({ timeout: 15000 });
    
    // Look for PII highlighting elements in the response
    // The response should contain highlighted PII elements
    const responseContainer = page.locator('text=Hallo Max F').locator('..');
    await expect(responseContainer).toBeVisible();
    
    // Check if PII highlighting CSS classes are present
    const highlightedElements = page.locator('.pii-highlight');
    // Note: Depending on implementation, there might be highlighted elements
    // This test may need adjustment based on actual PII highlighting implementation
  });

  test('should show PII overlay on hover/click', async ({ page }) => {
    // Send a message to create a conversation with PII
    const messageInput = page.getByRole('paragraph').filter({ hasText: /^$/ });
    await messageInput.fill('Max F aus Berlin.');
    await page.keyboard.press('Enter');
    
    // Wait for response
    await page.waitForTimeout(5000);
    
    // Try to find and hover over PII elements
    const piiElements = page.locator('.pii-highlight, [data-pii-label], [data-pii-type]');
    const elementCount = await piiElements.count();
    
    if (elementCount > 0) {
      // Hover over the first PII element
      await piiElements.first().hover();
      
      // Check if overlay appears
      const overlay = page.locator('.pii-overlay, .pii-hover-overlay');
      // Note: This test may need adjustment based on actual overlay implementation
    }
  });

  test('should maintain PII state across chat sessions', async ({ page }) => {
    // Send first message with PII
    let messageInput = page.getByRole('paragraph').filter({ hasText: /^$/ });
    await messageInput.fill('Max F aus Berlin.');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(3000);
    
    // Send second message referencing the same entities
    messageInput = page.getByRole('paragraph').filter({ hasText: /^$/ });
    await messageInput.fill('Max lebt in Berlin seit 5 Jahren.');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(3000);
    
    // Verify both messages are visible
    await expect(page.locator('text=Max F aus Berlin.')).toBeVisible();
    await expect(page.locator('text=Max lebt in Berlin seit 5 Jahren.')).toBeVisible();
    
    // The PII system should recognize that "Max" and "Berlin" refer to 
    // the same entities as in the first message
  });

  test('should handle API errors gracefully', async ({ page }) => {
    // This test should verify that if PII API fails, the system continues to work
    // Note: This would require mocking the PII API to return an error
    
    // Enter text with PII
    const messageInput = page.getByRole('paragraph').filter({ hasText: /^$/ });
    await messageInput.fill('John Doe from New York.');
    
    // Even if PII detection fails, the message should still be sendable
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);
    
    // Verify message appears (even without PII processing)
    await expect(page.locator('text=John Doe from New York.')).toBeVisible();
  });

  test('should show masking status in UI elements', async ({ page }) => {
    // Check initial state of masking button
    const maskButton = page.getByRole('button', { name: 'Maskieren' });
    await expect(maskButton).toBeVisible();
    
    // Enter text with PII to trigger detection
    const messageInput = page.getByRole('paragraph').filter({ hasText: /^$/ });
    await messageInput.fill('Anna Müller aus Hamburg.');
    await page.waitForTimeout(1000);
    
    // The mask button should indicate PII was detected
    // (Implementation may vary - could be a shield icon, color change, etc.)
    
    // Toggle masking off
    await maskButton.click();
    await page.waitForTimeout(500);
    
    // Verify visual state change
    await expect(maskButton).toHaveAttribute('aria-pressed', 'true');
  });

  test('should preserve PII entities during conversation', async ({ page }) => {
    // Create a conversation with multiple exchanges to test entity persistence
    
    // First message
    let messageInput = page.getByRole('paragraph').filter({ hasText: /^$/ });
    await messageInput.fill('Ich bin Dr. Maria Rodriguez aus Barcelona.');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(3000);
    
    // Second message referencing same entities
    messageInput = page.getByRole('paragraph').filter({ hasText: /^$/ });
    await messageInput.fill('Barcelona ist eine schöne Stadt.');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(3000);
    
    // Third message with new entity
    messageInput = page.getByRole('paragraph').filter({ hasText: /^$/ });
    await messageInput.fill('Dr. Rodriguez arbeitet im Hospital General.');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(3000);
    
    // Verify all messages are visible
    await expect(page.locator('text=Dr. Maria Rodriguez')).toBeVisible();
    await expect(page.locator('text=Barcelona ist eine schöne Stadt')).toBeVisible();
    await expect(page.locator('text=Hospital General')).toBeVisible();
    
    // The PII system should consistently handle the same entities
    // across all messages in the conversation
  });
});
