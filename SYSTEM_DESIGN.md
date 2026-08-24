# System Design — Ticket Booking System

## 1. Seat Hold & TTL Mechanism

Every physical `Seat` belonging to a venue is projected into a per-event `ShowSeat` row (`status`: `AVAILABLE | HELD | BOOKED`), so the same physical seat can be booked for one show and free for another. When a customer selects seats, the backend creates a `SeatHold` record plus one `SeatHoldItem` per seat, and stamps each affected `ShowSeat.holdExpiresAt` with `now() + SEAT_HOLD_TTL_MINUTES` (default 10, fully configurable via environment variable — never hard-coded).

The frontend renders a live countdown from this timestamp, but it is purely cosmetic. The **database `expiresAt` is the single source of truth**: every read path (seat map, checkout, booking creation) re-checks it server-side. Expiration is enforced two ways simultaneously for reliability without extra infrastructure:

1. **Lazy expiry** — any operation that touches a seat (a new hold attempt, booking confirmation) first checks `holdExpiresAt < now()` and reclaims the seat inline if so, before doing its own work.
2. **Active expiry** — a lightweight `setInterval` background worker (`jobs/expiryWorker.js`) polls every 15 seconds for `SeatHold`s past their TTL, releases their seats back to `AVAILABLE`, and emits `SEAT_RELEASED` over Socket.IO so every connected browser updates without a refresh.

This avoids introducing Redis, Kafka, or a job queue — a single Postgres timestamp column plus a poll loop is sufficient at this scale and keeps the dependency graph minimal, per the assignment's explicit request.

## 2. Concurrency Prevention

The critical risk is two customers racing for the same seat. The naive `if (seat.status === 'AVAILABLE') seat.status = 'HELD'` pattern is unsafe because the read-then-write is not atomic. Instead, every state transition uses a **conditional UPDATE**:

```sql
UPDATE "ShowSeat" SET status='HELD', "holdExpiresAt"=$1
WHERE id=$2 AND status='AVAILABLE'
```

Postgres takes a row-level lock the instant this UPDATE runs. If two requests fire concurrently for the same seat, the database serializes them: the first to acquire the lock wins and its row matches (`status='AVAILABLE'`) so `rowCount = 1`; the second finds the row already `HELD` by the time its UPDATE executes, so `rowCount = 0`. The code checks this count and throws a `409 SEAT_UNAVAILABLE` conflict rather than a generic error. No explicit `SELECT ... FOR UPDATE` or advisory lock is needed — the WHERE clause on the UPDATE *is* the atomic compare-and-swap.

For **multi-seat holds**, every seat's conditional UPDATE runs inside one `prisma.$transaction`. If any single seat fails to claim, the function throws and Prisma rolls back the entire transaction — seats already claimed within that transaction are reverted automatically, satisfying the "all-or-nothing" requirement without manual compensation logic.

The same pattern protects **booking confirmation**: converting a hold into a booking re-validates `SeatHold.status === 'ACTIVE'` and `expiresAt` *inside* the transaction (not just before it), closing the race window between the background worker expiring a hold and the user clicking "Confirm."

## 3. Waitlist Auto-Assignment

Each `WaitlistEntry` is scoped to `(eventId, categoryId, userId)` with a `queuePosition` assigned at join time (`count of WAITING entries + 1`), giving deterministic FIFO ordering per category — Premium and Standard queues are independent.

When a booking is cancelled, the system iterates its freed seats and calls `assignSeatToWaitlist(eventId, showSeatId)`. This looks up the seat's category, finds the oldest `WAITING` entry for that `(event, category)`, and — critically — reuses the **same conditional-UPDATE pattern** to claim the seat (`AVAILABLE → HELD`) atomically before creating the `WaitlistOffer`. If two cancellations or two worker ticks somehow raced for the same seat, only one would successfully flip its status and only one offer would be created; the loser simply finds `rowCount = 0` and exits. This guarantees "no active offer already owns the seat" without a separate lock table.

## 4. Time-Limited Offer Handling

A successful claim creates a `WaitlistOffer` (`status=PENDING`, `expiresAt = now() + WAITLIST_OFFER_TTL_MINUTES`) and emails the customer a claim link. Accepting an offer converts it into an ordinary `SeatHold` owned by that user and reuses the standard booking-from-hold flow — so acceptance is bound by the exact same expiry and concurrency guarantees as a normal booking.

If the customer does nothing, the same background worker that expires seat holds also scans for `PENDING` offers past `expiresAt`. It marks the offer `EXPIRED`, marks the waitlist entry `CANCELLED`, releases the seat to `AVAILABLE`, and **immediately calls `assignSeatToWaitlist` again** for the same seat — cascading the offer to the next customer in the FIFO queue in one pass, with no manual intervention required.
