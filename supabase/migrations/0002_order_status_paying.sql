-- Agent Auditor: add the `paying` order status (SPEC.md sections 0.18, 4, 10). Owner: Nizar.
--
-- The gateway saves an order as `paying` before it signs the payment, so the Streams webhook
-- never sees a memo whose order doesn't exist yet. Run after 0001_init.sql. Safe to re-run.

begin;

alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('pending_review', 'denied', 'paying', 'paid', 'booked', 'exception'));

commit;
