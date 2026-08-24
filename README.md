# 🎟️ Ticket Booking System - Cinema & Concert Platform

A high-concurrency ticket booking platform built with **Node.js, Express, Prisma ORM, PostgreSQL / SQLite, React (Vite), Tailwind CSS, and Socket.IO**. Designed to handle flash-demand booking rushes with **atomic concurrency protection**, **automatic seat-hold TTL expiry**, **real-time seat map synchronization**, and **FIFO category waitlists with time-limited claim offers on cancellation**.

---

## 🌟 Key Features

* **Interactive Visual Seat Map**: Rendered per-show with distinct visual states (*Available*, *Selected*, *Held*, *Booked*, *Offered*) and category tiers (*Premium*, *Standard*).
* **Strict Concurrency Protection**: Atomic database transactions prevent race conditions. Simultaneous attempts for the same seat guarantee exactly 1 winner; all competing requests receive `409 Conflict`.
* **Seat Hold with Configurable TTL**: Seats are placed on temporary hold during checkout (e.g. 10 minutes). A live countdown displays visual urgency states.
* **Dual-Layer Auto-Release**: Expired holds are released lazily on query and actively via background workers, instantly broadcasting `SEAT_RELEASED` over WebSockets.
* **FIFO Category Waitlist**: Customers join a category-specific waitlist when an event sells out.
* **Automatic Cancellation Reallocation**: Cancelling a booking instantly triggers the waitlist engine, generating a time-limited claim link (`/waitlist/claim/:token`) and emailing the next customer in line.
* **Offer Expiration & Auto-Advancement**: If an offered seat is unclaimed within the TTL (e.g. 5 minutes), the background worker automatically cascades the offer to the next waitlisted customer.
* **Encrypted QR Code Tickets**: Confirmed bookings generate an encrypted QR code containing the booking reference, delivered instantly via email.
* **Role-Based Portals**:
  * **Customer**: Browse events, filter by type/genre, hold seats, checkout, manage bookings, cancel with auto-waitlist trigger.
  * **Organiser**: View revenue analytics, tickets sold, capacity occupancy, and create new movie/concert listings.
  * **Admin**: Design custom venues, seating grids (rows $\times$ cols), and seat categories.
* **1-Click Demo Switcher**: Instant role toggle bar on the navbar to simulate multi-user race conditions, cancellations, and waitlist claims seamlessly.

---

## 🚀 Quick Start Guide

### Prerequisites
* **Node.js** v18+ (tested on Node v20/v24)
* **npm** v9+

### 1. Clone & Setup Backend
```bash
cd backend
npm install
npm run db:setup
```
> `npm run db:setup` runs `prisma generate`, `prisma db push`, and `prisma/seed.js`. It seeds test accounts, venues, events, showseats, and a sample confirmed booking.

### 2. Setup Frontend
```bash
cd ../frontend
npm install
```

### 3. Run the Complete Application
Open two terminals:

**Terminal 1 (Backend):**
```bash
cd backend
npm start
# Backend runs on http://localhost:5000
```

**Terminal 2 (Frontend):**
```bash
cd frontend
npm run dev
# Frontend runs on http://localhost:5173
```

Open `http://localhost:5173` in your browser!

---

## 🧪 Automated Verification & Concurrency Tests

Run the full automated test suite verifying concurrency safety, TTL auto-release, and waitlist auto-assignment:

```bash
cd backend
npm test
```

### Individual Test Suites:
* **Simultaneous Seat Selection Concurrency Test**:
  ```bash
  npm run test:concurrency
  ```
  *Fires simultaneous parallel hold requests for the exact same seat. Verifies exactly 1 succeeds and remainder receive 409 Conflict.*
* **Seat Hold TTL & Auto-Release Test**:
  ```bash
  npm run test:hold
  ```
  *Tests hold placement, TTL expiration simulation, and background worker auto-release.*
* **Waitlist Auto-Assignment on Cancellation Test**:
  ```bash
  npm run test:waitlist
  ```
  *Tests FIFO queue order, booking cancellation trigger, tokenized offer issuance, and offer claim cycle.*

---

## 👥 Demo Accounts (Pre-Seeded)

| Role | Email | Password | Purpose |
|---|---|---|---|
| **Admin** | `admin@tickets.com` | `admin123` | Venue Builder & Auditorium Layouts |
| **Organiser** | `organiser@cinema.com` | `org123` | Event Creation & Revenue Analytics |
| **Customer 1** | `customer1@test.com` | `cust123` | Booking & Cancellation Simulation |
| **Customer 2** | `customer2@test.com` | `cust123` | Race Conditions & Waitlist Claims |
| **Customer 3** | `customer3@test.com` | `cust123` | FIFO Queue Depth Verification |

*(You can also use the **"Switch Demo Role"** button on the top-right of the frontend to switch between any of these accounts in 1 click!)*

---

## ⚙️ Environment Variables (.env.example)

Create `.env` inside `backend/`:

```env
# Database Connection (SQLite default for zero-config run, or PostgreSQL)
DATABASE_URL="file:./dev.db"
# Example PostgreSQL:
# DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ticket_booking?schema=public"

# Server Configuration
PORT=5000
NODE_ENV=development

# JWT Authentication
JWT_SECRET=super-secret-jwt-key-change-in-production-ticket-booking-2026
JWT_EXPIRES_IN=7d

# Seat Hold & Waitlist TTL (in minutes)
SEAT_HOLD_TTL_MINUTES=10
WAITLIST_OFFER_TTL_MINUTES=5

# Frontend URL
FRONTEND_URL=http://localhost:5173

# Email Service (Optional - SMTP provider / leaves empty for built-in virtual preview)
EMAIL_HOST=smtp.ethereal.email
EMAIL_PORT=587
EMAIL_USER=
EMAIL_PASSWORD=
EMAIL_FROM="Ticket Booking System <no-reply@ticketbooking.com>"
```

---

## 🗄️ Database Schema & Entity Models

```
┌──────────┐       ┌──────────────┐       ┌───────────┐
│   User   │──────<│   SeatHold   │>──────│ ShowSeat  │
└────┬─────┘       └──────────────┘       └─────┬─────┘
     │                                          │
     │             ┌──────────────┐             │
     ├────────────<│   Booking    │>────────────┤
     │             └──────┬───────┘             │
     │                    │                     │
     │             ┌──────┴───────┐             │
     │             │    Ticket    │             │
     │             └──────────────┘             │
     │                                          │
     │             ┌──────────────┐             │
     ├────────────<│WaitlistEntry │             │
     │             └──────┬───────┘             │
     │                    │                     │
     │             ┌──────┴───────┐             │
     └────────────<│WaitlistOffer │>────────────┘
                   └──────────────┘
```

### Prisma Models:
* **User**: `id, name, email, password, role (CUSTOMER, ORGANISER, ADMIN)`
* **Venue**: `id, name, city, address, totalRows, seatsPerRow`
* **SeatCategory**: `id, venueId, name, color, basePriceMultiplier`
* **Seat**: `id, venueId, row, number, seatLabel, categoryId`
* **Event**: `id, title, description, type, genre, durationMinutes, posterUrl, venueId, organiserId, eventDate, showTime, premiumPrice, standardPrice, status`
* **ShowSeat**: `id, eventId, seatId, row, number, seatLabel, categoryName, price, status (AVAILABLE, HELD, BOOKED, OFFERED), version, holdExpiresAt, heldByUserId`
* **SeatHold**: `id, eventId, userId, showSeatId, status (ACTIVE, EXPIRED, CONVERTED, RELEASED), expiresAt`
* **Booking**: `id, bookingReference, userId, eventId, totalAmount, status (CONFIRMED, CANCELLED), qrCodeData`
* **BookingSeat**: `id, bookingId, showSeatId, seatLabel, categoryName, price`
* **WaitlistEntry**: `id, eventId, userId, seatCategoryName, position, status (WAITING, OFFERED, CLAIMED, EXPIRED, CANCELLED)`
* **WaitlistOffer**: `id, waitlistEntryId, eventId, userId, showSeatId, token, expiresAt, status (PENDING, CLAIMED, EXPIRED)`
* **Ticket**: `id, bookingId, ticketNumber, issuedAt`

---

## 📡 REST API Documentation

### Authentication
* `POST /api/auth/register` — Register a new account (`name, email, password, role`)
* `POST /api/auth/login` — Login & receive signed JWT token
* `GET /api/auth/me` — Get current authenticated user profile *(Bearer Auth)*

### Events & Venues
* `GET /api/events` — Browse events with optional query filters (`type=MOVIE|CONCERT`, `genre`, `search`, `date`)
* `GET /api/events/:id` — Get event details, category pricing, and occupancy stats
* `POST /api/events` — Create event & initialize show seating grid *(Organiser/Admin)*
* `GET /api/venues` — List all venues and seating layouts
* `POST /api/venues` — Create venue and generate seating layout grid *(Admin)*

### Seats & Concurrency-Safe Holds
* `GET /api/seats/:eventId/seats` — Get real-time seat map with statuses & hold expirations
* `POST /api/seats/:eventId/hold` — Concurrency-protected seat hold acquisition (`showSeatIds`) *(Customer)*
* `POST /api/seats/:eventId/release-hold` — Manually release held seats on checkout abandon *(Customer)*

### Bookings & Tickets
* `POST /api/bookings` — Complete booking from valid active hold (`eventId, showSeatIds`) *(Customer)*
* `GET /api/bookings/my` — Customer booking history with QR codes *(Customer)*
* `GET /api/bookings/:id` — Single booking details and ticket payload *(Customer/Admin)*
* `POST /api/bookings/:id/cancel` — Cancel booking and auto-trigger waitlist reallocation *(Customer/Admin)*

### Waitlist & Time-Limited Offers
* `POST /api/waitlist/events/:eventId/join` — Join category waitlist (`seatCategoryName`) *(Customer)*
* `GET /api/waitlist/my` — Get user active waitlist entries & active offers *(Customer)*
* `GET /api/waitlist/offers/:token` — View offer details & remaining time *(Public with Token)*
* `POST /api/waitlist/offers/:token/claim` — Claim waitlist offer and confirm booking *(Customer)*

### Organiser Analytics
* `GET /api/organiser/summary` — Get total events, tickets sold, revenue, and occupancy *(Organiser/Admin)*

---

## 🧠 Seat Hold & Waitlist Logic Explanation

### 1. Concurrency Control & Hold Placement
1. When a customer selects seats, `/api/seats/:id/hold` initiates an atomic database transaction.
2. The transaction inspects target `ShowSeat` records. If any seat is `BOOKED`, `OFFERED`, or `HELD` by another user with a non-expired TTL, the transaction aborts and returns `409 Conflict`.
3. If available, `ShowSeat` status is updated to `HELD` with `holdExpiresAt = NOW() + 10m` and an incremental version counter.
4. The server emits `seat_status_changed` (`SEAT_HELD`) via Socket.IO room `event:<id>` so all other users' visual maps update in real-time.

### 2. Hold Expiry & Auto-Release
1. The background worker `holdTtlWorker.js` runs every 4 seconds.
2. It queries all seats where `status = 'HELD'` and `holdExpiresAt <= NOW()`.
3. Expired seats are atomically reset to `AVAILABLE`, and `seat_status_changed` (`SEAT_RELEASED`) is broadcast to connected clients.

### 3. Waitlist Auto-Assignment on Cancellation
1. When Customer A cancels a booking, `bookingService.cancelBooking` marks the booking as `CANCELLED`.
2. For each released seat, `waitlistService.processSeatFreed` queries the oldest active waitlist entry (`status = 'WAITING'` ordered by `createdAt ASC`).
3. If an eligible customer is found:
   - The seat transitions to `OFFERED`.
   - A secure crypto token is generated with `expiresAt = NOW() + 5m`.
   - An HTML email containing the direct claim link is dispatched via `nodemailer`, and a WebSocket notification is sent to the user's private channel.
4. The customer claims the offer before expiration to book the ticket.
5. If the offer expires without being claimed, `waitlistOfferWorker.js` flags the offer as `EXPIRED` and automatically forwards the seat to the next waitlisted customer in the queue.

---

## 🌐 Hosted Application & Public URLs

| Component | URL | Notes |
|---|---|---|
| **Live Frontend Application** | [**https://long-worlds-judge.loca.lt**](https://long-worlds-judge.loca.lt) | Live Interactive UI & Seat Map |
| **Live Backend API & WebSockets** | [**https://crazy-banks-know.loca.lt**](https://crazy-banks-know.loca.lt) | REST API & Real-time WebSockets |
| **API Health Check** | [**https://crazy-banks-know.loca.lt/api/health**](https://crazy-banks-know.loca.lt/api/health) | Live Health Check |

### Cloud Hosting Configuration (Vercel & Render)
* **Frontend (Vercel)**: Configured with `frontend/vercel.json` for SPA routing.
* **Backend (Render / Railway)**: Configured with `backend/render.yaml` for persistent WebSockets and background TTL schedulers.

