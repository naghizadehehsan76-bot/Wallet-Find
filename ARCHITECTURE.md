# Wallet-Find / 12Keys — Architecture

## 1. Repository Structure

The repository contains two main applications:

- `frontend/`
- `backend/`

The root directory contains project documentation and shared development instructions.

## 2. Frontend Architecture

Technology:

- React
- TypeScript
- Vite

Main responsibilities:

- render the user interface
- manage local UI state
- manage authentication state
- display contest state
- collect user answers
- communicate with backend APIs
- manage language and text direction

Frontend must never be the authority for:

- answer correctness
- contest progression
- ranking
- permissions
- official timing

## 3. Backend Architecture

Technology:

- Node.js
- Express
- TypeScript

Main responsibilities:

- authentication
- authorization
- contest management
- clue management
- answer validation
- progression
- response timing
- leaderboard calculation
- player statistics

The backend is the authoritative application layer.

## 4. Database

Technology:

- PostgreSQL
- Neon
- Prisma ORM

The database stores persistent application state.

Important domain entities currently include:

- User
- Contest
- ContestClue
- Submission

Additional entities already exist for future advertising and system functionality.

## 5. Authentication

Authentication uses JWT.

Frontend:
- stores the authentication token locally
- sends the token using the Authorization header

Backend:
- validates JWT
- identifies the user
- identifies the user's role

Required format:

Authorization: Bearer <token>

Server-side authorization is mandatory.

## 6. Contest Domain

A Contest contains:

- title
- description
- status
- start time
- end time
- clues

A ContestClue contains:

- contest ID
- sequence number
- clue type
- clue content
- correct answer
- publication information

A contest contains exactly 12 logical clue positions for the MVP.

## 7. Contest Progression

Progression is server-controlled.

The backend determines:

- which clue is currently active for the player
- whether the player has solved a clue
- whether the player may submit an answer
- whether a submission is correct
- whether the next clue becomes available

The frontend only displays the state returned by the backend.

## 8. Submission Flow

Expected flow:

Frontend:
1. player enters answer
2. frontend sends contest ID, clue ID and answer

Backend:
1. authenticate user
2. validate request
3. validate contest
4. determine the player's current clue
5. reject attempts to skip clues
6. normalize/validate the answer
7. compare with the stored correct answer
8. store the Submission
9. calculate authoritative response timing
10. return the result

The correct answer must never be returned to normal clients.

## 9. API Organization

Contest functionality belongs in the Contest module.

Current structure:

`src/modules/contest/`

Expected responsibilities:

- routes
- controllers
- services
- schemas

Controllers should handle:

- HTTP input
- validation
- HTTP response codes

Services should handle:

- business logic
- Prisma/database operations
- contest rules

Schemas should handle:

- request validation

## 10. Frontend Services

API communication belongs in:

`frontend/src/services/`

The frontend should not scatter raw fetch calls across multiple components.

Reusable API operations should be centralized in the service layer.

## 11. Internationalization

Translations belong in:

`frontend/src/i18n/`

Current languages:

- Persian
- English

Language selection should be persistent.

The active language controls:

- displayed translations
- HTML `lang`
- HTML `dir`

Direction:

- Persian / Arabic → RTL
- English → LTR

## 12. UI Component Structure

Reusable interface elements should live in:

`frontend/src/components/`

Page-level components should live in:

`frontend/src/pages/`

Do not duplicate common UI elements unnecessarily.

The bottom navigation is a shared component.

## 13. Contest UI Architecture

The Competition page is the primary contest interface.

The contest grid is:

3 columns × 4 rows

for 12 total positions.

The current key contains the answer input directly inside the key cell.

A separate answer page is not part of the normal contest flow.

## 14. Leaderboard Architecture

Leaderboard data must eventually come from backend APIs.

The backend calculates ranking.

The frontend displays the returned ranking.

The frontend must not calculate official rankings.

## 15. Profile Architecture

Profile information should come from authenticated backend APIs.

The frontend should not hardcode player statistics in production.

## 16. Wallet Architecture

Wallet is a future subsystem.

For MVP:
- wallet UI may remain mocked
- no real withdrawal flow is required
- no private keys or sensitive wallet secrets belong in the frontend

Real wallet functionality should be implemented only after the core contest engine is stable.

## 17. Error Handling

Backend uses stable machine-readable error identifiers.

Frontend maps those identifiers to localized human-readable messages.

Do not expose raw stack traces to users.

Production responses must not leak secrets or internal implementation details.

## 18. Data Authority

Server authority:

- authentication
- authorization
- contest status
- clue progression
- answer correctness
- official timing
- ranking
- completion state

Client authority:

- presentation
- local UI state
- input collection
- language preference

## 19. Development Principle

Prefer the smallest safe change that satisfies the requirement.

Inspect existing code before editing.

Reuse existing modules and services.

Avoid unnecessary rewrites.

Never replace working architecture simply to make implementation easier.

## 20. Deployment Principle

Production deployment must be reproducible.

The project should eventually support:

- frontend deployment
- backend deployment
- production database
- environment variables
- HTTPS
- health checks

No production secret may be committed to Git.

## 21. Definition of Architectural Completion

The architecture is considered stable when:

- frontend and backend responsibilities are clearly separated
- contest logic is server authoritative
- API access is centralized
- authentication is secure
- i18n is centralized
- UI components are reusable
- automated testing covers critical business logic
- production deployment is reproducible
