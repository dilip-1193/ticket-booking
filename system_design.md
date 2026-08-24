# System Design: High-Concurrency Ticket Booking Architecture

## 1. Overview & Architecture
The Ticket Booking System is architected to handle high-demand movie and concert ticketing where thousands of concurrent customers compete for a finite set of seats. The architecture adopts a decoupled client-server model powered by **Node.js, Express, Prisma ORM, PostgreSQL/SQLite, React (Vite), and Socket.IO** for real-time bidirectional synchronization.

```
[Clients (React)] <--(WebSockets / REST)--> [API & WebSocket Gateway]
                                                    |
                       +----------------------------+----------------------------+
                       |                                                         |
             [Seat & Concurrency Service]                              [Background Schedulers]
                       |                                                - Seat Hold TTL Worker
             [ACID Transactions]                                        - Waitlist Offer Worker
                       |                                                         |
         [(PostgreSQL / SQLite Database)] <--------------------------------------+
```

---

## 2. Concurrency Protection for Simultaneous Seat Selection
When multiple customers attempt to reserve the same seat simultaneously (e.g., Row A, Seat 10), naive read-then-write logic causes race conditions and double bookings.

### Concurrency Mechanism:
1. **Atomic Interactive Database Transactions**: Every seat hold and checkout is encapsulated in a database transaction (`prisma.$transaction`).
2. **Pessimistic Row-Level Locking / Versioning**: In PostgreSQL, the engine executes `SELECT ... FOR UPDATE` (or atomic conditional updates `UPDATE "ShowSeat" SET status = 'HELD', version = version + 1 WHERE id = $1 AND status = 'AVAILABLE'`).
3. **Deterministic State Invariant Check**: The engine verifies within the transaction that the requested seat is either `AVAILABLE` or held under an already expired timestamp (`holdExpiresAt < NOW()`).
4. **Single Winner Guarantee**: Exactly one competing transaction succeeds and transitions the seat to `HELD`. Competing concurrent transactions fail and receive an immediate `409 Conflict` HTTP response with a descriptive error.

---

## 3. Seat Hold & TTL Auto-Release Mechanism
To prevent seats from being locked indefinitely during checkout abandonment, the system enforces a strict **Time-To-Live (TTL)** (default: 10 minutes).

### Hold & Expiry Flow:
1. **Hold Acquisition**: Upon selection, `ShowSeat` is updated with `status = 'HELD'`, `heldByUserId = user.id`, and `holdExpiresAt = NOW() + SEAT_HOLD_TTL_MINUTES`. An audit record is created in `SeatHold`.
2. **Real-Time Broadcast**: The server emits a `seat_status_changed` event (`SEAT_HELD`) over Socket.IO to the show room (`event:<id>`). All connected browsers reflect the held state instantly.
3. **Frontend Urgency Timer**: The client runs a synchronized countdown displaying color-coded urgency (Green $\to$ Amber at $<2$ min $\to$ Red/pulsing at $<30$ sec).
4. **Dual-Layer Expiry Enforcement**:
   - **Lazy Expiry on Read**: API queries automatically treat seats with `holdExpiresAt < NOW()` as `AVAILABLE`.
   - **Background Worker**: A lightweight interval worker (`holdTtlWorker.js`, running every 4 seconds) scans for expired holds in bulk, atomically resets `status = 'AVAILABLE'`, marks the hold as `EXPIRED`, and broadcasts `SEAT_RELEASED` over WebSockets.

---

## 4. Waitlist Auto-Assignment & Time-Limited Offer Flow
When an event category (e.g., Premium) sells out, customers join a **FIFO (First-In, First-Out) Waitlist** keyed by `[eventId, seatCategoryName]`.

```
[Booking Cancelled] 
        │
        ▼
[Fetch Top FIFO Waitlist Candidate] ──(None)──> [Seat Reverts to AVAILABLE]
        │ (Candidate Found)
        ▼
[ShowSeat: OFFERED] ──> [Generate Secure Token & TTL (5m)] ──> [Email & WebSocket Alert]
        │
   ┌────┴──────────────────────────┐
   ▼                               ▼
[Customer Claims]           [Offer Expires]
   │                               │
[Seat: BOOKED + QR Ticket]  [Mark EXPIRED ──> Trigger Next FIFO Candidate]
```

### Cancellation & Auto-Reallocation Pipeline:
1. **Cancellation Trigger**: When Customer A cancels a booking, an atomic database transaction marks the booking as `CANCELLED` and triggers `waitlistService.processSeatFreed(eventId, categoryName, showSeatId)`.
2. **Top Candidate Selection**: The engine queries the oldest active entry (`status = 'WAITING'` ordered by `createdAt ASC`).
3. **Time-Limited Offer Generation**:
   - The seat transitions to `status = 'OFFERED'`.
   - A unique crypto token is generated with `expiresAt = NOW() + WAITLIST_OFFER_TTL_MINUTES` (default: 5 minutes).
   - An HTML email containing the private claim link is dispatched via `nodemailer`, and a real-time notification (`waitlist_offer_received`) is emitted to the customer's private WebSocket channel.
4. **Claim Execution**: The waitlisted customer clicks the link and confirms booking before expiry. The transaction converts the offer to `CLAIMED`, seat to `BOOKED`, generates a unique booking reference (`TBS-2026-XXXXXX`), generates a QR ticket, and dispatches the confirmation email.
5. **Auto-Advancement on Expiry**: If the customer fails to claim within the TTL, `waitlistOfferWorker.js` flags the offer as `EXPIRED` and immediately invokes `processSeatFreed` for the next person in line. If the waitlist is exhausted, the seat reverts to `AVAILABLE`.

---

## 5. QR Code Generation & Verification
Every confirmed booking generates a unique encrypted reference. The `qrcode` service generates a high-density Base64 QR code encoding `{ ref, eventTitle, seats, customerName, timestamp }`. The digital ticket is rendered with CSS perforations for printing and delivered via email.
