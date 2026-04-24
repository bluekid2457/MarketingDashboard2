
# Epic Overview

**Epic Name:** Workflow Simplification & Inline AI Editor Overhaul  
**Epic Hypothesis/Goal:** Streamline the idea input and backlog experience, eliminate redundant UI, fix selection and reference bugs, and deliver a modern, in-place AI editing and diffing experience across Storyboard and Platform Adaptation.  
**Key Personas:**  
- Content Creator  
- Marketing Manager  
- Admin  
- System (AI/Automation)  

---

# Feature Breakdown & User Stories

---

## 1. Idea Input & Backlog (Home)

### Feature: Remove Redundant Format Selectors

**Context:** The "Format" and "Format All" dropdowns in the idea input and backlog are confusing and unnecessary, as content format is chosen later.

**User Story 1: Remove Format Selectors from Idea Input**
- **Story:**  
  - As a Content Creator  
  - I want the "Format" and "Format All" dropdowns removed from the idea input area  
  - So that the UI is less cluttered and less confusing  
- **Acceptance Criteria:**  
  - **Scenario 1: Happy Path**  
    - **Given** I am on the idea input screen  
    - **When** I add a new idea  
    - **Then** there are no "Format" or "Format All" dropdowns visible  
  - **Scenario 2: No Regressions**  
    - **Given** I submit an idea  
    - **When** I proceed through the workflow  
    - **Then** I am prompted to select a format only at the appropriate later step  
- **Technical/UX Notes:** Remove all references to "Format" and "Format All" selectors from the idea input UI and logic.

**User Story 2: Remove Format Column from Ideas Table**
- **Story:**  
  - As a Content Creator  
  - I want the "Format" column removed from the "Your Ideas" table  
  - So that the table only shows relevant information  
- **Acceptance Criteria:**  
  - **Scenario 1: Happy Path**  
    - **Given** I view my ideas backlog  
    - **When** the table renders  
    - **Then** there is no "Format" column  
  - **Scenario 2: No Layout Issues**  
    - **Given** The column is removed  
    - **When** I view the table  
    - **Then** the table layout remains clean and readable  
- **Technical/UX Notes:** Remove the "Format" column header and all associated data cells.

---

## 2. AI Angles & Outlines

### Feature: Fix Multi-Selection Bug

**Context:** Selecting an angle can result in multiple cards (e.g., 1, 4, 6) showing as "Selected" at once. Selection state must be tied to a unique ID.

**User Story 3: Only One Angle Can Be Selected**
- **Story:**  
  - As a Content Creator  
  - I want only one angle card to be in the "Selected" state at a time  
  - So that I always know which angle is active  
- **Acceptance Criteria:**  
  - **Scenario 1: Happy Path**  
    - **Given** I have a list of angles  
    - **When** I select an angle  
    - **Then** only that card is visually selected and all others are unselected  
  - **Scenario 2: Multi-Click Edge Case**  
    - **Given** I rapidly click multiple "Select this Angle" buttons  
    - **When** the UI updates  
    - **Then** only the last clicked card is selected  
  - **Scenario 3: Visual Consistency**  
    - **Given** I select an angle  
    - **When** I regenerate or update the list  
    - **Then** the selection state is preserved or reset as appropriate  
- **Technical/UX Notes:** Selection state must be managed by a unique angle ID, not by index or a global boolean.

---

## 3. Storyboard Inline Editor (Priority 1)

### Feature: In-Place Editing & Live Diff

**Context:** The AI prompt and diff controls should float directly over the text being edited, not in a sidebar or top bar. Diffs should use red/green highlights, and the text should remain directly editable.

**User Story 4: Inline Editor Floats Over Edited Text**
- **Story:**  
  - As a Content Creator  
  - I want the AI prompt and diff controls to appear directly over the text I am editing  
  - So that I can see and interact with changes in context  
- **Acceptance Criteria:**  
  - **Scenario 1: Happy Path**  
    - **Given** I trigger the inline editor  
    - **When** the editor appears  
    - **Then** the prompt and diff controls float over or near the selected text, not in a sidebar or at the top  
  - **Scenario 2: Multiple Edits**  
    - **Given** I edit multiple sections  
    - **When** I trigger the editor in each  
    - **Then** each section has its own floating controls  
- **Technical/UX Notes:** Use absolute or sticky positioning. Each editable block should have its own ref and floating UI.

**User Story 5: Live Diff with Red/Green Highlight**
- **Story:**  
  - As a Content Creator  
  - I want to see additions and deletions highlighted in green and red, respectively, within the text  
  - So that I can easily review AI changes  
- **Acceptance Criteria:**  
  - **Scenario 1: Happy Path**  
    - **Given** I submit an AI edit  
    - **When** the diff is shown  
    - **Then** additions are highlighted with a green background, deletions with a red background, inline with the text  
  - **Scenario 2: No Change**  
    - **Given** The AI returns no changes  
    - **When** the diff is shown  
    - **Then** a message "No changes suggested" is displayed  
- **Technical/UX Notes:** Use a diff algorithm (e.g., diff-match-patch). Apply `bg-green-100` for additions, `bg-red-100` for deletions.

**User Story 6: Direct Editability During AI Review**
- **Story:**  
  - As a Content Creator  
  - I want to be able to manually edit the text even while an AI prompt is active or a diff is pending  
  - So that I am not blocked by the AI workflow  
- **Acceptance Criteria:**  
  - **Scenario 1: Happy Path**  
    - **Given** An AI diff is visible  
    - **When** I click into the text  
    - **Then** I can edit the text directly  
  - **Scenario 2: Accept/Reject**  
    - **Given** I have made manual edits  
    - **When** I accept or reject the AI suggestion  
    - **Then** my manual edits are preserved or merged as appropriate  
- **Technical/UX Notes:** The text area remains editable at all times. Accepting an AI diff merges the AI suggestion with any manual changes.

---

## 4. Storyboard Features & Clean-up

### Feature: Remove Revision History

**Context:** The "Revised [Section Name]" history log below the editor is unnecessary and creates clutter.

**User Story 7: Remove Revision History Log**
- **Story:**  
  - As a Content Creator  
  - I want the revision history log removed from the storyboard editor  
  - So that the interface is clean and focused  
- **Acceptance Criteria:**  
  - **Scenario 1: Happy Path**  
    - **Given** I open the storyboard editor  
    - **When** I make edits  
    - **Then** there is no revision history log visible  
  - **Scenario 2: No Regressions**  
    - **Given** The log is removed  
    - **When** I accept/reject changes  
    - **Then** the accept/reject logic still works  
- **Technical/UX Notes:** Remove all UI and state related to revision history.

### Feature: Fix Source/Reference Detection

**Context:** The "References" section is not detecting sources even when present.

**User Story 8: References Detected and Linked**
- **Story:**  
  - As a Content Creator  
  - I want all valid sources and references in the storyboard to be detected and linked  
  - So that I can click through to original materials  
- **Acceptance Criteria:**  
  - **Scenario 1: Happy Path**  
    - **Given** I add a valid URL or citation  
    - **When** I save or view the storyboard  
    - **Then** the reference is detected and rendered as a clickable link  
  - **Scenario 2: Invalid Reference**  
    - **Given** I add an invalid or malformed reference  
    - **When** I save  
    - **Then** a validation error is shown  
- **Technical/UX Notes:** Update the regex or parsing logic to handle all standard URL and citation formats.

---

## 5. General Workflow

### Feature: Standardize Platform Adaptation Inline Editor

**Context:** All improvements to the Storyboard inline editor (floating bar, in-place diffs, direct editability) must be ported to the Adapt tab.

**User Story 9: Platform Adaptation Editor Matches Storyboard**
- **Story:**  
  - As a Content Creator  
  - I want the Adapt tab's inline editor to have the same floating, in-place diff, and editability features as the Storyboard  
  - So that my editing experience is consistent across the app  
- **Acceptance Criteria:**  
  - **Scenario 1: Happy Path**  
    - **Given** I use the Adapt tab  
    - **When** I trigger the inline editor  
    - **Then** the UI and behavior matches the Storyboard editor (floating bar, live diff, direct editability)  
  - **Scenario 2: No Duplicated Text**  
    - **Given** I edit content in Adapt  
    - **When** a diff is shown  
    - **Then** revised text only appears in the diff bar, not duplicated in the main text area  
- **Technical/UX Notes:** Reuse the Storyboard inline editor logic and UI components in Adapt.

---

# Non-Functional Requirements (NFRs)

- **Security:**  
  - All user data encrypted at rest and in transit  
  - Rate limiting on API endpoints  
  - Inline editor prompt submissions sanitized before sending to AI  
- **Performance:**  
  - Inline AI generation and diffing must complete within 5 seconds for 95% of requests  
  - UI updates (selection, diff, floating bar) must be instant and smooth  
- **Tracking/Analytics:**  
  - Track idea submissions, angle selections, AI prompt usage, accept/reject actions, and reference detection events

---
