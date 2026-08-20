# Dogfood QA Report

**Target:** http://localhost:8090 (Helm — AI Governance Control Plane)
**Date:** 2026-08-16
**Scope:** Full dashboard — all navigation pages, forms, CRUD operations, configuration
**Tester:** Hermes Agent (automated exploratory QA)

---

## Executive Summary

| Severity | Count |
|----------|-------|
| 🔴 Critical | 0 |
| 🟠 High | 1 |
| 🟡 Medium | 3 |
| 🔵 Low | 2 |
| **Total** | **6** |

**Overall Assessment:** The Helm dashboard is functional and usable, with a clean dark-themed UI and working CRUD operations across all major features. However, there are several UX issues including misleading color usage for zero values, incorrect role parsing in user creation, missing keyboard accessibility, and stateless session handling.

---

## Issues

### Issue #1: Zero values in Gateway metrics displayed in red (misleading)

| Field | Value |
|-------|-------|
| **Severity** | 🟠 High |
| **Category** | Visual |
| **URL** | http://localhost:8090/ (Console/Overview page) |

**Description:**
On the Console overview page, the "GATEWAY" flow panel shows live counts for "0 proxied" and "0 blocked" in red text. Red is universally associated with errors, warnings, or negative states. Using red for zero counts — which indicate normal operation with no problems — is misleading and could cause unnecessary alarm.

**Steps to Reproduce:**
1. Log in to the dashboard at http://localhost:8090
2. Navigate to the OVERVIEW page (default landing page)
3. Observe the "REQUEST PASSAGE · LIVE COUNTS" panel
4. Note the red-colored "0 proxied" and "0 blocked" values

**Expected Behavior:**
Zero values should be displayed in a neutral color (white or gray), consistent with the zero values shown elsewhere on the page (e.g., "PROVIDERS 0" in the flow diagram uses muted gray text).

**Actual Behavior:**
The "0 proxied" and "0 blocked" values in the GATEWAY card are displayed in red text, implying an error state when no error exists.

**Screenshot:**
MEDIA:/home/moonbuggy/Documents/Management Harness/dogfood-output/screenshots/dashboard-overview.png

---

### Issue #2: Roles field concatenates values without separator in user creation

| Field | Value |
|-------|-------|
| **Severity** | 🟠 High |
| **Category** | Functional |
| **URL** | http://localhost:8090/ (Operators → + Add operator) |

**Description:**
When creating a new operator via the "+ Add operator" modal, entering comma-separated roles (e.g., "operator,viewer") results in the roles being concatenated without the comma separator in the database. The saved value becomes "operatorviewer" instead of ["operator", "viewer"]. The UI input has no visible delimiter or validation to indicate the expected format.

**Steps to Reproduce:**
1. Log in and navigate to Operators page
2. Click "+ Add operator" button
3. Fill in: Email = "dave@example.com", Name = "Dave Wilson", Roles = "operator,viewer"
4. Click Save
5. Observe the new operator in the table — the Roles column shows "operatorviewer"

**Expected Behavior:**
The roles should be parsed as a comma-separated list and saved as distinct roles (e.g., `["operator", "viewer"]`). The display should show them as separate tags or with proper delimiters.

**Actual Behavior:**
The roles string "operator,viewer" is saved as a single concatenated string "operatorviewer" without the comma. The parsing logic strips the comma.

**Console Errors:**
None observed.

---

### Issue #3: No visual feedback during page navigation (loading indicators missing)

| Field | Value |
|-------|-------|
| **Severity** | 🟡 Medium |
| **Category** | UX |
| **URL** | http://localhost:8090/ (all pages) |

**Description:**
When clicking navigation buttons in the sidebar, there is no visible loading indicator or transition state. The page content appears to change instantly, but API calls are being made in the background. Users have no feedback that a navigation action is being processed, especially on slower connections.

**Steps to Reproduce:**
1. Log in and observe the current page
2. Click on any navigation button (e.g., "CONFIGURATION")
3. Observe that there is no spinner, loading text, or visual transition
4. The new content appears after a brief delay with no indication of loading

**Expected Behavior:**
A loading indicator (spinner, skeleton, or "Loading..." text) should appear when navigating between pages, especially since content is loaded via API calls.

**Actual Behavior:**
No loading feedback is provided. The user clicks and must wait silently for the content to appear.

---

### Issue #4: Configuration page shows "Loading providers…" indefinitely when no providers exist

| Field | Value |
|-------|-------|
| **Severity** | 🟡 Medium |
| **Category** | UX |
| **URL** | http://localhost:8090/ (Configuration page) |

**Description:**
When navigating to the Configuration page with no providers configured, the page displays "Loading providers…" but never progresses to a "No providers yet" empty state message. Users are left waiting without knowing if the page is stuck or still loading.

**Steps to Reproduce:**
1. Log in and navigate to the Configuration page
2. Observe the Providers section
3. Note that it shows "Loading providers…" indefinitely

**Expected Behavior:**
After a reasonable timeout or failed API call, the page should display an empty state message like "No providers yet. Add one to route traffic."

**Actual Behavior:**
The loading text persists indefinitely with no empty state fallback.

---

### Issue #5: No keyboard navigation support / focus indicators on interactive elements

| Field | Value |
|-------|-------|
| **Severity** | 🟡 Medium |
| **Category** | Accessibility |
| **URL** | http://localhost:8090/ (all pages) |

**Description:**
Interactive elements (buttons, inputs, navigation items) lack visible focus indicators when navigating via keyboard. Tab navigation through the interface reveals no focus outlines, making keyboard-only navigation difficult or impossible for users who rely on it.

**Steps to Reproduce:**
1. Log in and press Tab to navigate through interactive elements
2. Observe that no focus ring or outline appears around focused elements
3. Try to activate buttons using Enter/Space — behavior is inconsistent

**Expected Behavior:**
All interactive elements should have visible focus indicators (outline, ring, or background change) when focused via keyboard. Buttons should be activatable via Enter or Space keys.

**Actual Behavior:**
No visible focus indicators. Keyboard navigation is not properly supported.

---

### Issue #6: Login session is not persisted after browser refresh

| Field | Value |
|-------|-------|
| **Severity** | 🔵 Low |
| **Category** | UX |
| **URL** | http://localhost:8090/ (Login page) |

**Description:**
After successfully logging in, refreshing the browser page returns the user to the login screen. The token stored in localStorage is not being read on page load to restore the session. Users must re-enter their token after every refresh.

**Steps to Reproduce:**
1. Log in with a valid token
2. Verify you are on the dashboard (main content visible)
3. Refresh the browser page (F5 or Ctrl+R)
4. Observe that the login screen appears again

**Expected Behavior:**
The application should check localStorage for an existing token on page load and restore the authenticated session without requiring re-login.

**Actual Behavior:**
The login view is displayed on every page load regardless of localStorage state.

---

### Issue #7: Admin role not indicated in user list despite user having admin role

| Field | Value |
|-------|-------|
| **Severity** | 🔵 Low |
| **Category** | Content |
| **URL** | http://localhost:8090/ (Operators page) |

**Description:**
Users with the "admin" role (created via API with `roles: ["admin"]`) show "No" in the Admin column of the Operators table. The "admin" role should be reflected as "Yes" in the Admin column since it grants administrative privileges.

**Steps to Reproduce:**
1. Create a user with `roles: ["admin"]` via API or dashboard
2. Navigate to the Operators page
3. Observe the Admin column for that user shows "No"

**Expected Behavior:**
Users with the "admin" role should show "Yes" in the Admin column, indicating their administrative privileges.

**Actual Behavior:**
All users show "No" in the Admin column regardless of their roles.

---

## Issues Summary Table

| # | Title | Severity | Category | URL |
|---|-------|----------|----------|-----|
| 1 | Zero values in Gateway metrics displayed in red (misleading) | 🟠 High | Visual | / |
| 2 | Roles field concatenates values without separator in user creation | 🟠 High | Functional | / → Operators |
| 3 | No visual feedback during page navigation (loading indicators missing) | 🟡 Medium | UX | / (all pages) |
| 4 | Configuration page shows "Loading providers…" indefinitely | 🟡 Medium | UX | / → Configuration |
| 5 | No keyboard navigation support / focus indicators | 🟡 Medium | Accessibility | / (all pages) |
| 6 | Login session not persisted after browser refresh | 🔵 Low | UX | / (login) |
| 7 | Admin role not indicated in user list despite admin role | 🔵 Low | Content | / → Operators |

---

## Testing Coverage

### Pages Tested
- Overview/Console (landing page with metrics)
- Operators (list, create via modal, view details)
- Policies (list, create via modal)
- Skills (list, create via modal with Draft with AI button)
- Cost & Savings (budget table)
- Configuration (editable providers, settings, secrets)
- Audit Chain (events list, chain verification)
- Provenance (sign/verify interface)

### Features Tested
- Authentication (token-based login via localStorage)
- User/Operator CRUD (create via modal, list with actions)
- Policy CRUD (create via modal)
- Skill CRUD (create via modal)
- Configuration editing (providers, settings, secrets)
- Navigation between all pages
- Audit chain display and verification status

### Not Tested / Out of Scope
- API key creation and revocation (Keys modal)
- User budget editing (Budget modal)
- Policy activation/deactivation
- Skills "Draft with AI" feature (requires LLM provider)
- Provenance sign/verify functionality (requires interactive testing)
- Mobile/responsive behavior
- Multi-user concurrent editing

### Blockers
- None. All major features were accessible and testable.

---

## Notes

### Positive Observations
- Clean, professional dark-themed UI with consistent design language
- All CRUD operations function correctly at the API level
- Audit chain verification works and shows "CHAIN INTACT"
- Configuration page successfully saves changes (button shows "Saved" feedback)
- Modal dialogs open correctly for create operations
- test data was successfully created and displayed

### Recommendations
1. **Color usage:** Use neutral colors (white/gray) for zero/empty values, reserve red for actual errors or warnings.
2. **Input parsing:** Add clear formatting hints for comma-separated inputs and validate/parse properly on submit.
3. **Loading states:** Add skeleton loaders or spinners for all async page transitions and data fetches.
4. **Keyboard accessibility:** Add `:focus` styles and ensure all interactive elements are keyboard-accessible.
5. **Session persistence:** Read localStorage token on page initialization to restore logged-in state.
6. **Admin column:** Fix the Admin column logic to check for "admin" role, not just `is_admin` flag.

### Test Environment
- Manager process running on localhost:8090
- Admin token: eee9525dba73b84f7a5b206562b7b2da
- Test users created: alice@example.com (admin), bob@example.com (viewer), charlie@example.com (operator), dave@example.com (operator,viewer)
- Test policies: Block EU IPs, Allow internal, Test Policy - Allow specific IPs
- Test skill: summarize (v1)
- Redis: enabled (localhost:6379, no password)
