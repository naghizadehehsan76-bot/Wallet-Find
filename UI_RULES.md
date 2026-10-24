# Wallet-Find / 12Keys — UI Rules

## 1. Visual Source of Truth

The existing `12keys.html` prototype is the primary visual reference for the application.

When implementing or modifying frontend features, preserve its visual language and structure unless the product owner explicitly requests a design change.

Do not replace the design with a generic dashboard, generic admin template, or generic React styling.

## 2. Core Visual Identity

Preserve the following visual identity:

- dark navy background
- brass/gold primary accent
- brass-light highlights
- verdigris/green solved state
- muted gray secondary text
- paper/light primary text
- subtle brass borders
- rounded cards
- restrained shadows
- mobile-first composition

The interface should feel like a premium puzzle / vault / key experience.

## 3. Layout

The main application shell is mobile-first.

Target visual width:

- approximately 480px maximum content width

The application should remain centered on larger screens.

Do not convert the interface into a wide desktop-first dashboard.

Preserve:

- compact spacing
- vertical content flow
- bottom navigation
- card-based sections
- focused single-column experience

## 4. Typography

The prototype uses:

- Vazirmatn for UI text
- JetBrains Mono for numeric/key/timer content

Preserve this typography hierarchy.

Do not replace the fonts unnecessarily.

Numbers, timers and key identifiers should retain the monospaced visual treatment.

## 5. Direction and Languages

The application supports multiple languages.

Persian:
- RTL

English:
- LTR

Additional RTL languages such as Arabic should be supported architecturally.

Changing language must change:

- translations
- document language
- document direction
- layout direction where appropriate

Do not create separate duplicated page layouts for each language.

## 6. Home Page

The Home page should preserve:

- 12Keys branding
- nightly contest introduction
- headline with highlighted 12-key phrase
- circular 12-key visual
- countdown
- primary contest CTA
- secondary authentication CTA
- statistics cards
- “how it works” section
- bottom navigation where applicable

The circular 12-key visual is a central branding element.

Do not replace it with a generic hero image.

## 7. Circular Key Visual

The Home page contains twelve key positions arranged around a circular center.

States:

- solved
- current
- locked

Preserve the visual distinction between these states.

The current key should remain visually prominent.

Solved keys should use the green/verdigris treatment.

Locked keys should remain visually subdued.

## 8. Competition Page

The Competition page must use a:

3 columns × 4 rows

grid containing exactly 12 key cells.

The grid must remain usable on small mobile screens.

The visual hierarchy should communicate:

- key number
- key status
- current key
- solved keys
- locked keys

## 9. Wallet-Inspired Ordered Key Entry

The key-entry experience should be visually and behaviorally inspired by the ordered recovery-word entry experience commonly found in MetaMask and similar wallet applications.

This is an interaction reference, not a request to copy MetaMask.

The goal is to make the user feel that they are filling a fixed ordered sequence of wallet-style words.

Requirements:

- all 12 positions remain visible simultaneously
- each position has a fixed number from 1 to 12
- each position corresponds to exactly one ordered word/key
- solved words remain associated with their original positions
- the current position is visually emphasized
- the current word is entered directly inside that position
- future positions remain locked
- the user progresses sequentially
- the current input should be immediately understandable
- the interaction should work comfortably on mobile
- the user should not need to open a separate normal answer page
- the transition from one key to the next should preserve the 12-position context

Do not copy:

- MetaMask logo
- MetaMask branding
- proprietary artwork
- exact proprietary UI
- MetaMask-specific visual identity

Only the general ordered-word wallet interaction pattern should be used as inspiration.

## 10. Inline Answer Input

The current key must contain the answer input directly inside its key cell.

Do not open a new page for normal answer entry.

Do not replace inline input with a modal unless explicitly requested.

The active key cell should provide a clear focused input area.

The current cell should visually communicate that it is the active interaction point.

The answer submit control should fit naturally inside the current key cell.

The solved key should display the resulting word/state in its original position without becoming a new layout.

## 11. Key States

Every key may visually be:

### Solved

- green/verdigris state
- visually different from locked keys
- not editable
- remains in its original position

### Current

- brass/gold emphasis
- contains the answer input
- visually dominant
- clearly indicates that this is the next word/key to enter

### Locked

- muted/subdued
- not editable
- cannot be submitted
- visually remains part of the 12-position sequence

## 12. Contest Header

Preserve:

- contest title
- contest date/time
- prize card
- compact top layout

The prize display should preserve the brass/light styling used by the prototype.

## 13. Rules

Rules should appear as compact rows beneath the main competition area.

Do not convert them into large modal dialogs by default.

## 14. Leaderboard

The leaderboard should preserve the prototype's compact list style.

Each row should communicate:

- rank
- avatar/initial
- username
- completion information
- total time

The leading player may receive a brass highlight.

Do not redesign the leaderboard as a large desktop table unless explicitly requested.

## 15. Profile

The Profile page should preserve:

- centered avatar
- username
- membership information
- statistics cards
- trust/reputation bar
- recent contest history
- compact status badges

## 16. Wallet

The Wallet page should preserve:

- centered balance card
- network information
- withdrawal/deposit actions
- transaction history
- compact transaction rows

For MVP, this page may remain mocked.

Do not implement real wallet operations as part of unrelated UI work.

## 17. Bottom Navigation

The bottom navigation is a persistent mobile navigation element.

Current destinations:

- Home
- Competition
- Leaderboard
- Wallet
- Profile

Preserve:

- fixed bottom position
- dark translucent background
- top border
- compact icon + label structure
- active state using brass/gold

Do not replace it with a conventional desktop sidebar unless explicitly requested.

## 18. Responsive Behavior

The interface must work on:

- small mobile screens
- normal mobile screens
- tablet-sized screens
- desktop screens

The design should remain visually closest to the mobile prototype.

Do not introduce horizontal scrolling.

Do not allow key cells to become unusably small.

The 3 × 4 grid must remain readable and usable.

## 19. Accessibility

Preserve the design while improving accessibility.

Interactive elements should:

- be keyboard accessible
- have visible focus states
- use semantic buttons/inputs
- have useful accessible labels where icons are used

Accessibility improvements must not unnecessarily alter the visual language.

## 20. Loading States

Loading states should use the existing visual language.

Avoid large generic spinners that dominate the screen.

Prefer:

- subtle inline loading indicators
- disabled states
- concise status messages

## 21. Error States

Errors should appear close to the relevant interaction.

Examples:

- login error near authentication form
- answer error near answer input
- loading failure near the affected section

Do not expose raw backend stack traces.

Use localized user-facing error messages.

## 22. Empty States

Empty states should remain compact and consistent with the 12Keys visual identity.

Do not introduce generic illustration-heavy empty pages.

## 23. Design Preservation Rule

Before changing an existing component, inspect its current CSS and JSX.

Do not rewrite styles unnecessarily.

Prefer:

- adding a small class
- changing a state
- inserting dynamic data
- connecting an existing control to an API

over recreating the entire component.

## 24. Prototype Fidelity

When a task is about functionality rather than visual redesign:

DO:
- preserve existing spacing
- preserve existing colors
- preserve existing dimensions
- preserve existing typography
- preserve existing component hierarchy
- preserve the 3 × 4 grid
- preserve inline word entry
- preserve the ordered 12-position experience

DO NOT:
- modernize the design automatically
- simplify the layout automatically
- change colors
- change the grid structure
- change the navigation structure
- replace inline answer input
- introduce unrelated UI libraries
- create a separate normal answer page
- change the ordered 12-word interaction pattern

## 25. Wallet Interaction Fidelity

The 12-word entry experience should communicate:

1. fixed numbered positions
2. one current active position
3. completed positions
4. locked future positions
5. direct word entry
6. clear progression from one position to the next

The experience should feel familiar to users who have seen wallet recovery-word entry flows while remaining visually unique to Wallet-Find.

## 26. Visual Regression Rule

After meaningful frontend changes:

1. build the frontend
2. run relevant tests
3. visually inspect the affected page
4. compare it against the prototype
5. verify the 3 × 4 grid
6. verify the inline current-word input
7. verify solved/current/locked states
8. fix unintended visual regressions before marking the task complete

## 27. Definition of UI Completion

A UI feature is complete only when:

- functionality works
- responsive behavior works
- language switching works
- RTL/LTR works where applicable
- existing visual style is preserved
- wallet-inspired ordered-word interaction is preserved
- accessibility is acceptable
- no obvious visual regression is introduced
