**Project Specification: Screen Capture & AI Summarization Web App**

---

## 1. Project Overview

We’re creating a **browser-based**, **offline-capable** web app that:

-   **Continuously captures** screenshots from the user’s desktop.
    
-   **Compares** each screenshot to the previous one, storing **only if** there’s a significant difference.
    
-   Performs **OCR** on every stored screenshot.
    
-   Summarizes the user’s recent activity through an **AI/LLM** integration (LangChain).
    
-   Stores and indexes all data locally to enable **keyword search** via a **Google Photos–style** interface.
    

This app must handle everything entirely within the browser, relying on:

-   `getDisplayMedia` for screen capture (user must grant permission).
    
-   File System Access API for local folder reads/writes.
    
-   Dexie/IndexedDB for local database storage.
    
-   Tesseract.js (WASM) for OCR.
    
-   Tailwind CSS for styling (dark mode only, minimal additional frameworks).
    
-   LangChain for the summarization flow (with user-configured model providers).
    

----------

## 2. Detailed Requirements

### 2.1. Screen Capture

1.  **Frequency**: Take a screenshot every **5 seconds**.
    
2.  **Permission Flow**: Use `getDisplayMedia` to request screen sharing.
    
    -   The user must select which screen/window to share.
        
    -   If the user wants to change screens, they must reload the page.
        
3.  **Diff Threshold**:
    
    -   Compare the new screenshot to the last saved screenshot using a pixel diff library (e.g., Pixelmatch).
        
    -   Only save if more than **3%** of pixels differ (default).
        
    -   This threshold is **user-adjustable**.
        
4.  **File Format**: Save **both PNG and JPEG** (at user-defined quality, default 80%). Delete whichever file is **larger** to keep storage minimal.
    
5.  **Filenames**: Use timestamp-based naming, e.g. `YYYY-MM-DD HH-mm-ss.png` (or `.jpg`).
    

### 2.2. Folder Access & Persistence

1.  **Local Folder**: User selects a folder with the File System Access API.
    
    -   The app **remembers** the chosen folder across sessions and attempts to **resume** without re-prompting if permissions remain valid.
        
2.  **Folder Unavailability**:
    
    -   If the folder moves or permissions are revoked, prompt the user to reselect a folder.
        
3.  **Automatic Resumption**:
    
    -   Capturing should resume automatically upon page reload if permissions are still granted.
        

### 2.3. OCR

1.  **Engine**: Use Tesseract.js (WebAssembly build) in-browser.
    
2.  **Timing**: Perform OCR **immediately** after each screenshot is saved (if it’s above the diff threshold).
    
3.  **Language**:
    
    -   Default to the user’s browser language.
        
    -   Let the user set a **custom language** in the settings modal.
        

### 2.4. Summarization (AI/LLM)

1.  **Tooling**: Use **LangChain** to allow multiple AI providers or local LLM usage.
    
2.  **Interval**: Every **30 minutes**, gather the OCR text (with ±10-minute overlap on the last chunk) and generate a summary.
    
3.  **Input Format**: Pass the raw OCR text plus the screenshot filenames/timestamps to the LLM, labeling it as OCR data.
    
4.  **Language**: The LLM output should **match** the user’s selected OCR language.
    
5.  **Failure Handling**:
    
    -   If a summarization call fails (network error, etc.), **log** to console and **skip** that chunk.
        

### 2.5. Data Storage (IndexedDB via Dexie)

1.  **Core Storage**:
    
    -   Store each screenshot’s OCR text, along with metadata (filename, timestamp).
        
    -   Store all summarization results, referencing which chunks or time ranges they represent.
        
2.  **Search**:
    
    -   Use Dexie’s indexing and **simple keyword-based** searching on stored text.
        
    -   Filter images and summaries in the UI by matching search terms.
        
3.  **Daily Snapshots**:
    
    -   Periodically (e.g., every few minutes) **export** the Dexie database to a JSON file stored in the same folder as screenshots.
        
    -   Use a **per-day** filename format: `db-YYYY-MM-DD.json`.
        
    -   Keep these **indefinitely** (no automatic deletion).
        

### 2.6. Data Retention & Cleanup

1.  **Screenshots & OCR**:
    
    -   **Auto-delete** data (screenshots, OCR text, summaries) older than **3 months** (default).
        
    -   User-adjustable in the settings modal.
        
2.  **Dexie JSON Snapshots**:
    
    -   Kept **forever** unless the user manually deletes them.
        

### 2.7. User Interface (Dark Mode Only)

1.  **Main View**: A single-page layout with a Google Photos–style **grid** of screenshots and summary “tiles.”
    
    -   Grouped **by day**.
        
    -   **Infinite scroll** and lazy loading as the user scrolls.
        
    -   Summaries appear as text-only tiles in the same chronological grid.
        
2.  **Search**: A text input that filters the grid.
    
    -   Matches are found in screenshot OCR text or summaries.
        
    -   Non-matching items are hidden.
        
3.  **Settings Modal**:
    
    -   **Open** via a settings icon/button.
        
    -   Adjust image quality (default 80%), diff threshold (default 3%), retention period (default 90 days), and OCR language.
        
    -   No advanced UI frameworks; just plain Tailwind and vanilla JS.
        
4.  **Capture Toggle**: A **subtle record/pause button** indicating capture state.
    
    -   Default to “recording.”
        
    -   Optionally pause capturing if the user wants to.
        
5.  **Folder Path Display**:
    
    -   Show the current folder path.
        
    -   Next to it, an “open folder” icon that opens the directory in the user’s file explorer (if supported).
        
6.  **No Notifications**:
    
    -   Remain silent unless the user interacts.
        
    -   Log errors to console rather than showing popups.
        

### 2.8. Offline/PWA Support

1.  **Service Worker + Manifest**:
    
    -   Enable the app to install as a PWA.
        
    -   Continue to capture and store data **offline** once loaded.
        
2.  **Summarization**:
    
    -   Dependent on the user’s chosen model/provider. If it’s a cloud-based API, summarization might fail offline.
        
    -   If local model usage is configured, summarization can still run offline.
        

### 2.9. Error Handling & Logging

-   All **errors** are **logged** to the JavaScript console.
    
-   The app does **not** show UI alerts or system notifications.
    
-   If summarization fails, skip that chunk.
    
-   If folder access is lost, prompt user to reselect.
    

----------

## 3. Architecture & Modules

1.  **Capture Module**
    
    -   `getDisplayMedia` usage, 5-second interval, pixel diff check, save final screenshot.
        
2.  **File Access Module**
    
    -   Manages folder permissions.
        
    -   Writes final screenshot (JPG/PNG) + Dexie JSON exports.
        
3.  **Diffing & Image Processing**
    
    -   Use a library like **pixelmatch** for approximate pixel comparison.
        
    -   Maintain last screenshot in memory for diff checks.
        
4.  **OCR Module**
    
    -   Tesseract.js (WASM).
        
    -   Trigger immediately post-save.
        
    -   Stores recognized text in Dexie.
        
5.  **Summarization Module**
    
    -   LangChain for LLM communication.
        
    -   Aggregates OCR text over 30-minute windows with ±10 overlap.
        
    -   Logs errors if they occur; no retry.
        
6.  **Storage Module** (Dexie)
    
    -   Tables for `screenshots`, `ocrText`, `summaries`, `settings`.
        
    -   Export daily snapshot as JSON.
        
7.  **UI Module**
    
    -   Tailwind-based single page.
        
    -   **Grid** with daily grouping.
        
    -   **Infinite scroll**.
        
    -   **Search bar** filtering.
        
    -   **Settings modal** for thresholds, retention, language, etc.
        
    -   **Record/Pause** toggle.
        
    -   **Folder path display**.
        
8.  **Retention Module**
    
    -   Periodic check (e.g., on app load or daily) to remove items older than X days (default 90).
        
9.  **PWA Module**
    
    -   Manifest with icons.
        
    -   Service worker for offline caching.
        
    -   Should allow the app to keep running if the tab is active or in the background (though background reliability can vary by browser).
        

----------

## 4. Error Handling Strategy

1.  **Folder Permissions**:
    
    -   On load, check if the folder permission is still valid. If not, prompt user to reselect.
        
    -   If attempts to write fail, show a minimal UI prompt or re-invite folder selection.
        
2.  **Summarization**:
    
    -   If network or LLM API fails, console-log the error, skip that chunk.
        
3.  **OCR**:
    
    -   If Tesseract fails, console-log and proceed with screenshot storage anyway (no recognized text).
        
4.  **Diffing**:
    
    -   If pixel comparison fails for some reason, fallback to always saving screenshots or log an error.
        

----------

## 5. Data & Privacy

-   **No cloud sync**: All data remains local unless user manually shares it.
    
-   **User is responsible** for any content captured, including sensitive information.
    
-   Automatic deletion after 90 days (default) can be adjusted in settings.
    

----------

## 6. Testing Plan

### 6.1. Unit Testing

1.  **Capture Interval & Diff**
    
    -   Mock out `getDisplayMedia`, feed test images to the diff function, confirm it meets the threshold logic.
        
2.  **OCR Integration**
    
    -   Use a small set of known images. Check Tesseract results in a controlled environment.
        
3.  **Summarization Chunking**
    
    -   Verify 30-minute windows plus ±10-minute overlap are formed correctly.
        
4.  **Settings**
    
    -   Check that changes to diff threshold or retention period propagate correctly.
        

### 6.2. Integration Testing

1.  **File System + Dexie**
    
    -   Confirm that screenshots and Dexie exports are written to the selected folder.
        
    -   Simulate permission revocation.
        
2.  **Offline/PWA**
    
    -   Test the service worker caching.
        
    -   Confirm that data capture works offline post-install.
        
3.  **LangChain Summaries**
    
    -   Check interactions with a test model or cloud-based provider in staging.
        
    -   Confirm logs handle error cases.
        

### 6.3. Manual Testing

1.  **User Flows**
    
    -   Start the app, grant screen access, grant folder access, confirm screenshots are captured.
        
    -   Let it run for 30+ minutes to confirm chunk-based summarization.
        
    -   Use the search bar to find recognized text.
        
    -   Check UI updates (infinite scroll, daily groupings).
        
2.  **Settings & Retention**
    
    -   Adjust settings (e.g., threshold, image quality) and confirm the correct changes in screenshot storage.
        
    -   Fast-forward system clock or manipulate data to ensure older screenshots are deleted properly.
        
3.  **Edge Cases**
    
    -   Switch monitors mid-session.
        
    -   Very large screens.
        
    -   Very busy scenes vs. minimal (almost no pixel change).
        

----------

## 7. Next Steps

1.  **Scaffolding & Setup**
    
    -   Initialize a plain JS or TypeScript project with Tailwind, Dexie, Tesseract.js, and LangChain.
        
    -   Include necessary build tools (e.g., Webpack, Vite, or similar).
        
2.  **Prototypes**
    
    -   Confirm basic `getDisplayMedia` capture.
        
    -   Save screenshots to the local folder.
        
    -   Perform a simple pixel diff check.
        
    -   Perform basic OCR, store text in Dexie.
        
3.  **UI & PWA**
    
    -   Build out the grid interface, daily grouping, infinite scroll.
        
    -   Add the record/pause button.
        
    -   Implement the settings modal and retention logic.
        
    -   Configure a service worker for offline support.
        
4.  **Testing**
    
    -   Write unit tests for each module.
        
    -   Conduct integration tests.
        
    -   Perform manual scenario checks.
        

----------

This specification captures **all** of the core decisions we made, from screenshot intervals to PWA behavior. A developer can now proceed with:

1.  **Setup** (dependencies, folder structure).
    
2.  **Module-by-module implementation** (Capture, OCR, Summarization, UI).
    
3.  **Testing** (unit, integration, manual).
    
4.  **UI polishing** (Tailwind, dark mode, daily grouping, search).
    
5.  **Deployment** (service worker, PWA manifest, hosting if desired, though it runs locally).
    

Following this spec ensures each requirement is met in the final solution.

### Final words
This app combines native browser APIs and client-side AI to deliver a privacy-respecting, platform-independent tool for automated screen tracking, summarization, and searchable history—designed for power users who need insight into their screen time without cloud dependence.