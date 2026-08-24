# CineBook — Ticket Booking System

A full-stack ticket booking platform for movies and concerts: visual seat selection, time-limited seat holds, concurrency-safe booking, automatic waitlist reassignment on cancellation, and QR-code tickets delivered by email.

## Project Overview

Customers browse events, pick seats on a visual grid, hold them for a configurable TTL, and check out. Sold-out seat categories offer a FIFO waitlist with automatic, time-limited offers when a seat frees up. Organisers manage events and pricing; admins configure venues and seat layouts.

## Features

- **Customer:** register/login, browse & filter events, visual real-time seat map, seat holds with countdown, checkout, QR ticket via email, booking history, cancellation, waitlist join + offer claim.
- **Organiser:** create events (venue/date/time/per-category pricing), view booking summary & revenue.
- **Admin:** create/manage venues, seat categories, and seat layouts.
- **Core engineering:** Postgres-authoritative concurrency control, TTL-based hold expiry, FIFO waitlist with atomic offer assignment, Socket.IO real-time seat updates, JWT + RBAC.

## Architecture

```
frontend/  React (Vite) + Tailwind + Socket.IO client
backend/   Node.js + Express + Prisma + PostgreSQL + Socket.IO
```

Seat state is stored **per show** (`ShowSeat`), not on the physical `Seat`, so the same physical seat can be `BOOKED` for one event and `AVAILABLE` for another. All concurrency-critical writes (`AVAILABLE → HELD`, `HELD → BOOKED`, waitlist offer claims) use conditional `UPDATE ... WHERE status = 'X'` statements inside Postgres transactions — the row lock taken by the UPDATE is the concurrency guard, so only one of two racing requests can ever succeed. See `SYSTEM_DESIGN.md` for full details.

## Technology Stack

- **Frontend:** React 18, Vite, React Router, Tailwind CSS, Axios, Socket.IO client
- **Backend:** Node.js, Express, Prisma ORM, PostgreSQL, Socket.IO, JWT, bcrypt, Nodemailer, `qrcode`
- **Real-time:** Socket.IO event rooms per event (`event:<eventId>`)

## Prerequisites

- Node.js 18+
- PostgreSQL 14+ (local or managed: Neon / Supabase / Railway / Render)
- An SMTP account for real email delivery (optional in dev — see Email Configuration)

## Installation

```bash
git clone <your-repo-url>
cd ticket-booking-system

# Backend
cd backend
npm install
cp .env.example .env   # fill in DATABASE_URL, JWT_SECRET, etc.

# Frontend
cd ../frontend
npm install
cp .env.example .env
```

## Environment Variables

**backend/.env** (see `backend/.env.example`):

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret used to sign JWTs |
| `JWT_EXPIRES_IN` | Token lifetime, e.g. `7d` |
| `PORT` | Backend port (default 5000) |
| `FRONTEND_URL` | Used for CORS + waitlist claim links |
| `EMAIL_HOST/PORT/USER/PASSWORD/FROM` | SMTP config (leave blank in dev — see below) |
| `SEAT_HOLD_TTL_MINUTES` | Seat hold duration (default 10) |
| `WAITLIST_OFFER_TTL_MINUTES` | Waitlist offer duration (default 10) |

**frontend/.env** (see `frontend/.env.example`):

| Variable | Description |
|---|---|
| `VITE_API_URL` | Backend REST base URL, e.g. `http://localhost:5000/api` |
| `VITE_SOCKET_URL` | Backend Socket.IO URL, e.g. `http://localhost:5000` |

## Database Setup & Prisma Migration

```bash
cd backend
npx prisma migrate dev --name init   # creates tables from prisma/schema.prisma
npm run seed                          # populates demo venues/events/users
```

`npm run seed` runs `prisma/seed.js`, which creates 2 venues, 3 events (normal availability, partially booked, and a sold-out Premium category with a waitlisted customer), and 4 demo accounts.

## Running Locally

```bash
# Terminal 1 — backend
cd backend
npm run dev        # http://localhost:5000

# Terminal 2 — frontend
cd frontend
npm run dev         # http://localhost:5173
```

## API Documentation

Base path: `/api`. Errors always return `{ "error": { "code": "...", "message": "..." } }` with the appropriate status (400/401/403/404/409/422/500 — seat races return 409).

**Auth**
```
POST /api/auth/register   { name, email, password, role? }
POST /api/auth/login      { email, password }
GET  /api/auth/me         (auth)
```

**Venues (admin writes, public reads)**
```
GET    /api/venues
GET    /api/venues/:venueId
POST   /api/venues                          { name, location }
PUT    /api/venues/:venueId
DELETE /api/venues/:venueId
POST   /api/venues/:venueId/categories       { name }
POST   /api/venues/:venueId/seats            { categoryId, rows: ["A","B"], seatsPerRow: 8 }
PUT    /api/seats/:seatId
DELETE /api/seats/:seatId
```

**Events**
```
GET    /api/events?type=&search=&venueId=
GET    /api/events/:eventId
GET    /api/events/:eventId/seats            → seat map + prices + category availability
POST   /api/events                           (organiser/admin) { venueId, name, type, eventDate, startTime, prices:[{categoryId, price}] }
PUT    /api/events/:eventId
DELETE /api/events/:eventId
```

**Holds**
```
POST   /api/events/:eventId/holds            (customer) { showSeatIds: [...] }
GET    /api/holds/:holdId
DELETE /api/holds/:holdId
```

**Bookings**
```
POST /api/bookings                           { holdId } → { booking, qrDataUrl }
GET  /api/bookings
GET  /api/bookings/:bookingId
POST /api/bookings/:bookingId/cancel
```

**Waitlist**
```
POST   /api/events/:eventId/waitlist         (customer) { categoryId }
GET    /api/events/:eventId/waitlist         (organiser/admin)
GET    /api/waitlists/me
DELETE /api/waitlists/:waitlistId
GET    /api/waitlist-offers/:offerId
POST   /api/waitlist-offers/:offerId/accept
```

**Organiser**
```
GET /api/organiser/dashboard
GET /api/organiser/events/:eventId/summary
GET /api/organiser/events/:eventId/revenue
```

## Authentication & RBAC

JWT bearer tokens (`Authorization: Bearer <token>`), passwords hashed with bcrypt. Roles: `CUSTOMER`, `ORGANISER`, `ADMIN`, enforced via an `authorize(...roles)` middleware on every write route per the RBAC matrix in the assignment (e.g. only customers hold/book/cancel/waitlist; only admins manage venues/seats/categories; organisers create events and view their own revenue).

## Seat Map & Seat Hold / TTL Logic

Seat status lives on `ShowSeat` (per event), not on `Seat` (physical). Selecting seats calls `POST /holds`, which — inside one DB transaction — atomically flips each `ShowSeat.status` from `AVAILABLE` to `HELD` using a conditional `UPDATE ... WHERE status='AVAILABLE'`, and records `holdExpiresAt = now() + SEAT_HOLD_TTL_MINUTES`. If any seat in a multi-seat request can't be claimed, the whole transaction rolls back (no partial holds). A background worker (`src/jobs/expiryWorker.js`) polls every 15s to release expired holds and broadcasts `SEAT_RELEASED` via Socket.IO. Full detail in `SYSTEM_DESIGN.md`.

## Concurrency Strategy

See `SYSTEM_DESIGN.md` §2 — conditional UPDATEs take Postgres row locks, so simultaneous requests for the same seat cannot both succeed; the loser receives `409 SEAT_UNAVAILABLE`.

## Waitlist Logic

Per-`(event, category)` FIFO queue via `queuePosition`. Cancellation frees a seat and calls `assignSeatToWaitlist`, which atomically reserves the seat (same conditional-UPDATE pattern) and creates a `WaitlistOffer` with its own TTL. Unclaimed offers expire via the same background worker and cascade to the next customer automatically. Full detail in `SYSTEM_DESIGN.md` §3–4.

## WebSocket Events

Clients join a per-event room: `socket.emit('JOIN_EVENT', eventId)` / `'LEAVE_EVENT'`. Server broadcasts to `event:<eventId>`:

```
SEAT_HELD      { showSeatId, expiresAt }
SEAT_RELEASED  { showSeatId }
SEAT_BOOKED    { showSeatId }
SEAT_CANCELLED { showSeatId }
```

## QR Ticket

Generated with the `qrcode` package, encoding **only the booking reference** (e.g. `TBS-8F29A1`) — never raw seat data. Rendered as a data URL, embedded in the confirmation email and shown on the booking details page.

## Email Configuration

Uses Nodemailer. If `EMAIL_HOST`/`EMAIL_USER` are unset, the backend automatically falls back to a `jsonTransport` (emails are logged to the console instead of sent) so the app runs out of the box in dev. For real delivery, set `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASSWORD`, `EMAIL_FROM` to any free-tier SMTP provider (e.g. Brevo, Mailtrap, Gmail app password).

## Testing

```bash
cd backend
npm test
```

`src/__tests__/bookingReference.test.js` and `errors.test.js` are pure unit tests and always run. `concurrency.integration.test.js` requires a live `DATABASE_URL` with migrations applied — it exercises two simultaneous hold requests for one seat (exactly one must succeed), expired-hold booking rejection, and waitlist FIFO + offer cascade. It self-skips if no database is reachable.

## Deployment

**Recommended:** Frontend → Vercel, Backend → Render or Railway, Database → Neon/Supabase/Railway/Render Postgres.

1. **Database:** create a managed Postgres instance, copy its connection string into `DATABASE_URL`.
2. **Backend (Render/Railway):** deploy the `backend/` folder. Build command `npm install && npx prisma generate`, start command `npx prisma migrate deploy && npm run seed && node src/server.js` (drop `&& npm run seed` after the first deploy). Set all env vars from `.env.example`. Ensure the platform's outbound port matches `PORT`, and enable WebSocket support (on by default on Render/Railway).
3. **Frontend (Vercel):** deploy `frontend/`, set `VITE_API_URL` and `VITE_SOCKET_URL` to the deployed backend's URL, build command `npm run build`, output directory `dist`.
4. Set backend `FRONTEND_URL` to the deployed Vercel URL for correct CORS + waitlist email links.

No `localhost` URLs are hard-coded anywhere in the source; everything is environment-driven.

## Project Structure

```
ticket-booking-system/
├── frontend/          React app (Vite)
│   └── src/{components,pages,layouts,context,services}
├── backend/           Express API
│   └── src/{controllers,routes,services,middleware,jobs,sockets,utils,config}
│   └── prisma/{schema.prisma,seed.js}
├── SYSTEM_DESIGN.md   800-word design write-up
├── README.md
```

## Troubleshooting

- **`prisma generate` fails to download engines:** you're likely behind a network filter blocking `binaries.prisma.sh`. Run it from a machine/CI with unrestricted internet, or use Prisma's `PRISMA_ENGINES_MIRROR` env var to point at a private mirror.
- **Sockets not updating live:** confirm `VITE_SOCKET_URL` matches the backend origin and that your host allows WebSocket upgrades (Render/Railway do by default).
- **Seats stuck as `HELD`:** the expiry worker polls every 15s; also confirm the backend process (not just requests) is kept alive — the worker runs in-process via `setInterval`.
- **Booking fails with `HOLD_EXPIRED`:** the seat hold's TTL (`SEAT_HOLD_TTL_MINUTES`) elapsed before checkout completed — this is expected/authoritative behavior, not a bug.

## Demo / Test Credentials

Seeded by `npm run seed` (password for all: `Password123!`):

| Role | Email |
|---|---|
| Admin | admin@example.com |
| Organiser | organiser@example.com |
| Customer | customer@example.com |
| Customer (on Premium waitlist for the sold-out demo event) | customer2@example.com |

**Development-only credentials — never used in production and password is documented here for grader convenience only.**
