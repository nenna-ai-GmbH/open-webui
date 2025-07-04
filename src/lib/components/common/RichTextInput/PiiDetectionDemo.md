# PII Detection Spinner - Visual Loading Indicator

## Overview

The RichTextInput component now includes a visual loading indicator that shows when PII (Personally Identifiable Information) masking requests are in progress. This provides clear feedback to users that their text is being processed for sensitive information.

## Features

- **Non-intrusive Design**: The spinner appears as a small, semi-transparent overlay in the top-right corner of the input field
- **Visual Consistency**: Uses the same spinner design as other loading indicators in the application
- **Automatic State Management**: Shows and hides automatically based on detection progress
- **Accessible**: Positioned to be visible but not interfere with text input

## Implementation Details

### Visual Design
- **Position**: Top-right corner of the input field
- **Style**: Semi-transparent white/gray background with backdrop blur
- **Size**: Small (16x16px) spinning icon
- **Z-index**: High enough to appear above text content

### State Management
- **Detection State**: Tracked via `isPiiDetecting` reactive variable
- **Callback Integration**: Uses `onDetectionStateChange` callback from PiiDetectionExtension
- **Automatic Updates**: Spinner visibility updates reactively with detection state

## Usage Example

```svelte
<RichTextInput
  value={messageText}
  placeholder="Type your message..."
  enablePiiDetection={true}
  piiApiKey={$settings.piiApiKey}
  conversationId={$currentConversation.id}
  onPiiDetected={handlePiiDetected}
  onPiiToggled={handlePiiToggled}
  on:change={handleTextChange}
/>
```

## Mock Implementation

The current implementation includes a mock PiiDetectionExtension that simulates the detection process:
- Shows spinner for 1-3 seconds after text changes
- Demonstrates the visual feedback without requiring actual PII detection API
- Can be replaced with full PII detection functionality when needed

## Benefits

1. **User Feedback**: Users know when their text is being processed
2. **Non-blocking**: Doesn't prevent continued typing during detection
3. **Subtle**: Doesn't distract from the main content
4. **Responsive**: Works well on different screen sizes

## Customization

The spinner can be customized by modifying:
- Position: Change `top-2 right-2` classes
- Size: Adjust `w-4 h-4` classes on the Spinner component
- Background: Modify `bg-white/80 dark:bg-gray-800/80` classes
- Animation: Spinner component includes CSS animation

This enhancement improves the user experience by providing clear visual feedback during PII detection processes while maintaining a clean, non-intrusive interface.