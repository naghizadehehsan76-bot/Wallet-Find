# Wallet-Find / 12Keys — Product Specification

## 1. Product Overview

Wallet-Find is a web-based 12-key contest.

Each contest contains exactly 12 sequential clues.

Players solve the clues in order. The objective is to solve all 12 keys as quickly as possible.

The product is mobile-first and uses the existing `12keys.html` prototype as the visual reference.

## 2. Core Player Flow

The primary player flow is:

Landing Page
→ Register / Login
→ Active Contest
→ 12-key contest grid
→ Solve current key
→ Submit answer inside the current key cell
→ Correct answer unlocks the next key
→ Solve all 12 keys
→ Contest completion
→ Leaderboard

There must not be a separate answer page for normal clue answering.

The answer input belongs directly inside the current key cell.

## 3. Contest Structure

Each contest has exactly 12 logical clue positions.

The clues are numbered:

1 through 12.

The order is fixed.

A player cannot skip ahead.

Only the current unsolved clue is answerable.

Future clues remain locked.

Solved clues remain visually marked as solved.

## 4. Contest Grid

The main contest UI uses a 3 × 4 grid:

Row 1:
1 | 2 | 3

Row 2:
4 | 5 | 6

Row 3:
7 | 8 | 9

Row 4:
10 | 11 | 12

The grid must remain responsive on mobile devices.

The current key contains the answer input directly inside the current key cell.

The user must not be redirected to another page to enter a normal clue answer.

## 5. Wallet-Style Key Entry Experience

The 12-key interaction should be visually and behaviorally inspired by the familiar experience of entering an ordered recovery phrase in MetaMask and similar wallet applications.

The goal is to create a familiar wallet-like phrase-entry experience while retaining the unique Wallet-Find / 12Keys visual identity.

Requirements:

- all 12 numbered positions remain visible simultaneously in the 3 × 4 grid
- each position represents one ordered word/key
- the order of positions is fixed from 1 through 12
- solved words remain associated with their numbered positions
- the current position is visually emphasized
- the current word is entered directly inside that position
- locked future positions remain visibly unavailable
- the user progresses sequentially
- no separate normal answer page should open
- the active input should feel like filling one position in an ordered recovery phrase
- the interface should be compact and mobile-friendly
- changing language must not change the logical order of the 12 positions

The experience may use wallet-style interaction patterns, but must not copy MetaMask branding, logos, proprietary artwork, or exact proprietary UI.

## 6. Answer Rules

The player submits an answer for the current clue.

The backend is authoritative.

Correct answer:
- records a correct Submission
- records response time
- marks the clue solved
- unlocks the next clue
- updates the active position in the 3 × 4 grid

Wrong answer:
- records a Submission
- records the attempt
- does not unlock the next clue
- leaves the current key active
- does not reveal the correct answer

The frontend must never determine whether an answer is correct.

## 7. Timing

Response timing is part of contest ranking.

The system must record timestamps for submissions.

The backend calculates authoritative response times.

Official ranking timing must not depend on the client's local clock.

## 8. Ranking

The leaderboard ranks players based on contest performance.

The primary ranking metric is total solving time across the 12 clues.

The system must also retain incorrect-attempt information because contest tie-breaking may use incorrect-answer count.

The final ranking must be calculated server-side.

## 9. Contest Completion

A player completes the contest after correctly solving clue 12.

The backend must mark the player as having completed the contest.

The completion timestamp must be stored.

The leaderboard must reflect completed players.

## 10. Authentication

The system supports:

- USER
- ADMIN

Authentication uses JWT.

Authenticated requests use:

Authorization: Bearer <token>

Users must be authenticated before participating in a contest.

Admin-only operations must be protected server-side.

## 11. Admin Capabilities for MVP

The MVP admin must be able to:

- create a contest
- create up to 12 clues
- define clue sequence
- define clue type
- define clue content
- define the correct answer
- activate a contest
- finish/cancel a contest when required

Correct answers must never be exposed to normal users.

## 12. Clue Types

The current data model supports:

- TEXT
- IMAGE
- PDF
- AUDIO
- VIDEO
- WEB_PAGE

The MVP should initially support TEXT clues.

Other clue types should remain architecturally supported and can be implemented progressively.

## 13. Languages

The product must support multiple languages.

Current supported languages:

- Persian
- English

The architecture must allow additional languages later.

Language switching must update:

- interface text
- page direction
- locale-sensitive formatting where appropriate

Persian:
RTL

English:
LTR

Additional RTL languages such as Arabic should be supported architecturally.

## 14. UI Source of Truth

The existing `12keys.html` prototype is the visual reference.

The following characteristics must be preserved unless explicitly changed by the product owner:

- dark navy visual theme
- brass/gold accent
- verdigris/green solved state
- mobile-first layout
- maximum content width around 480px
- bottom navigation
- circular 12-key visual on the landing page
- 3 × 4 contest grid
- inline answer input
- visual distinction between solved, current and locked states
- wallet-inspired ordered-word interaction

Do not redesign the interface as part of backend or feature work.

## 15. Main Pages

The intended player-facing pages are:

1. Home
2. Authentication
3. Competition
4. Leaderboard
5. Profile
6. Wallet

Key answering remains embedded in the Competition page.

## 16. Home Page

The Home page communicates:

- nightly contest concept
- 12 keys
- prize
- countdown
- participation information
- how the contest works

The circular 12-key visual is a major part of the visual identity.

## 17. Competition Page

The Competition page displays:

- contest title
- contest date/time
- prize
- 12-key 3 × 4 grid
- key status
- current clue
- inline answer field
- short rules

The answer field belongs inside the active key cell.

The page must not open a separate normal answer-entry page.

The interaction should visually resemble entering one ordered recovery word at a time.

## 18. Leaderboard

The leaderboard displays at minimum:

- rank
- username/display name
- completed clue count
- total solving time

The leaderboard must eventually be populated from the backend.

## 19. Profile

The Profile page is intended to display:

- player identity
- contest participation count
- best rank
- solved key count
- trust/reputation information
- recent contest history

## 20. Wallet

The Wallet page is intended to display:

- available balance
- network information
- deposits
- withdrawals
- transaction history

For MVP, wallet functionality may remain mocked until the contest engine is complete.

## 21. Security Principles

The backend is authoritative.

Never expose:

- password hashes
- JWT secret
- database credentials
- clue correct answers

Never trust:

- client-side contest progression
- client-side timers for ranking
- client-side roles
- client-side answer validation

## 22. MVP Definition of Done

The MVP is considered complete when a normal user can:

1. register
2. login
3. access an active contest
4. see all 12 key positions in a 3 × 4 grid
5. see only the current key as answerable
6. see the current answer input inside that key position
7. enter the word without opening a separate answer page
8. receive correct/incorrect feedback
9. unlock the next key after a correct answer
10. complete all 12 keys
11. appear in the leaderboard

The MVP must have:

- successful frontend build
- successful backend build
- automated tests for critical contest logic
- no known critical security issue
- multilingual architecture
- responsive mobile UI
- wallet-inspired ordered-word entry experience
