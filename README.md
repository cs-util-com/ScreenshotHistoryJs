# Screenshot History Web App

Screenshot History is a browser-based, offline-capable web application designed to capture, process, and summarize desktop screenshots. It provides a searchable, Google Photos–style interface for managing screenshots and summaries, all while keeping data local for privacy.

## Features

- **Continuous Screen Capture**: Automatically captures screenshots at user-defined intervals.
- **Pixel Difference Check**: Saves screenshots only if significant changes are detected.
- **OCR Integration**: Extracts text from screenshots using Tesseract.js.
- **AI Summarization**: Generates summaries of user activity using LangChain with support for OpenAI, Google Gemini, Anthropic Claude, and local models.
- **Searchable History**: Enables keyword-based search through OCR text and summaries.
- **Data Retention**: Automatically deletes old screenshots and summaries after a user-defined period (default: 90 days).
- **Offline Support**: Works offline with IndexedDB and the File System Access API.
- **User-Friendly Interface**: Dark mode, daily grouping, infinite scroll, and customizable settings.

## Technologies Used

- **Frontend**: HTML, Tailwind CSS, and vanilla JavaScript.
- **OCR**: Tesseract.js (WebAssembly).
- **AI Summarization**: LangChain with multiple model providers.
- **Storage**: IndexedDB via Dexie.js.
- **File Management**: File System Access API.
- **Offline Support**: Service Worker and PWA capabilities.

## Usage

1. **Select a Folder**:
   - Use the "Select Folder" button to choose a directory for storing screenshots and database files.

2. **Start Capturing**:
   - Click the "Start Capture" button to begin capturing screenshots at regular intervals.

3. **Search and Summarize**:
   - Use the search bar to find screenshots or summaries by keywords.
   - Summaries are generated every 30 minutes based on OCR text.

4. **Adjust Settings**:
   - Open the settings modal to customize:
     - Image quality (default: 80%).
     - Diff threshold (default: 3%).
     - Retention period (default: 90 days).
     - OCR language and resolution.
     - AI model provider and API keys.

5. **Offline Usage**:
   - The app works offline after the initial load. Screenshots and data are stored locally.

## AI Integration

- **Supported Models**:
  - OpenAI (e.g., GPT-3.5 Turbo).
  - Google Gemini.
  - Anthropic Claude.
  - Local models (e.g., LLaMA).

- **Configuration**:
  - Set API keys and model preferences in the settings modal.

## Disclaimer

This project is provided as-is. It is a general-purpose tool and does not include domain-specific functionality. Use and modify as needed.

## License

This project is licensed under the GNU General Public License v3.0. See the [LICENSE](./LICENSE) file for details.